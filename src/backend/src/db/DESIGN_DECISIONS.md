# AnonyProof – Database Schema Design Decisions

## 1. Cryptographic Field Type: BYTEA(32) over VARCHAR(66)

**Decision**: All cryptographic values (`group_id`, `identity_commitment`, `nullifier_hash`, `hash_value`, `zero_value`) use **BYTEA**.

| Factor | BYTEA(32) | VARCHAR(66) hex |
|---|---|---|
| Storage | 32 bytes + 1 byte header | 66 bytes + 1 byte header |
| Index size | ~51% smaller | ~2× larger |
| Comparison speed | Raw memcmp | Text collation-aware compare |
| Insert/query serialisation | `decode('ab01…','hex')` | Direct string literal |
| Debugging in psql | Requires `encode(col,'hex')` | Human-readable out of the box |

**Rationale**: At scale (millions of Merkle tree nodes, votes, posts) the 51% storage reduction and faster binary comparisons dominate. The debugging inconvenience is mitigated by two helper views (`v_semaphore_groups`, `v_semaphore_members`) that render hex automatically.

---

## 2. Votes: Individual Rows vs Counters Only

**Decision**: Store each vote as an individual row in the `votes` table **and** maintain cached `upvotes`/`downvotes` counters on `posts`/`comments`.

**Why both?**

| Approach | Pros | Cons |
|---|---|---|
| Counters only | Simple, fast reads | No audit trail, can't undo, can't recompute |
| Individual rows only | Full audit, undo-able | Expensive COUNT on every page load |
| **Hybrid (chosen)** | Audit trail + instant reads | Slight write overhead |

The application layer handles vote insertion and counter updates in a single transaction:

```typescript
await db.transaction().execute(async (tx) => {
  await tx.insertInto('votes').values(vote).execute();
  await tx.updateTable('posts')
    .set({ upvotes: sql`upvotes + 1` })
    .where('id', '=', targetId)
    .execute();
});
```

`vote_score` is a `GENERATED ALWAYS AS (upvotes - downvotes) STORED` column, updated automatically by PostgreSQL whenever `upvotes` or `downvotes` change.

**Why not DB triggers?** Vote aggregate triggers caused hidden cross-table UPDATEs on every INSERT, coupling three tables at the DB level and making the write path opaque. Moving this to the app layer keeps it explicit, debuggable, and avoids per-row trigger overhead during bulk operations.

**Concurrency**: The app-layer UPDATE acquires a row-level lock on the target post/comment, serialising concurrent vote inserts for the same target. This is acceptable because vote contention on a single post is typically low.

---

## 3. Comment `group_id` Consistency Enforcement

**Challenge**: A comment's `group_id` must always match its parent post's `group_id` to prevent cross-group pollution and ZKP group-membership correlation.

**Options considered**:

| Option | Assessment |
|---|---|
| Remove `group_id` from comments, derive via JOIN | Correct but forces a JOIN on every query; poor read perf |
| CHECK constraint with sub-query | Not allowed in PostgreSQL (CHECK cannot reference other tables) |
| BEFORE INSERT/UPDATE trigger | Validates at write time but adds hidden SELECT per insert |
| **Application-layer validation (chosen)** | Validated during ZKP verification before insert; explicit and testable |

The application layer validates group consistency during the comment creation flow — the ZKP verification step already confirms the user is a member of the target group, and the service verifies `group_id` matches the parent post before inserting. Denormalising `group_id` onto comments avoids a JOIN on every feed query.

**Why not a DB trigger?** The app already performs ZKP group membership verification before insert. A trigger would add a redundant SELECT per comment and split validation logic across two layers. Since this is a privacy-critical check, it's better to have it visible and testable in application code rather than hidden in a trigger.

---

## 4. Append-Only `admin_actions` Enforcement

**Decision**: BEFORE UPDATE and BEFORE DELETE triggers that unconditionally raise exceptions.

**Why not REVOKE UPDATE/DELETE?**

REVOKE-based approaches require careful role management and can be accidentally overridden by superusers granting privileges. The trigger approach is defence-in-depth: even a superuser running an ad-hoc UPDATE hits the trigger. If an emergency truly requires mutation, the superuser can `ALTER TABLE … DISABLE TRIGGER trg_admin_actions_no_update` temporarily, which is an auditable, visible action.

---

## 5. One Active AI Model Version per Model Name

**Decision**: Partial unique index.

```sql
CREATE UNIQUE INDEX idx_ai_model_active
  ON ai_model_versions (model_name) WHERE is_active = TRUE;
```

This is more efficient than a trigger because:
- It's a **declarative constraint** — PostgreSQL enforces it at the storage layer.
- It has zero runtime overhead for inserts where `is_active = FALSE`.
- It fails fast with a clear unique-violation error.

Deployment workflow: wrap model swap in a transaction:
```sql
BEGIN;
  UPDATE ai_model_versions SET is_active = FALSE, deactivated_at = now()
   WHERE model_name = 'perspective-api' AND is_active = TRUE;
  UPDATE ai_model_versions SET is_active = TRUE,  activated_at   = now()
   WHERE model_name = 'perspective-api' AND version = 'v2';
COMMIT;
```

---

## 6. Credential Issuance Isolation Strategy

**Decision**: Separate `onboarding` schema + Row-Level Security + 90-day auto-purge.

This is the **only** table where a real identity (email) touches a cryptographic commitment. Three layers of defence:

1. **Schema isolation**: Lives in `onboarding.*`, never `public.*`. Application code that queries content tables cannot accidentally JOIN to it.
2. **Row-Level Security**: `ENABLE ROW LEVEL SECURITY` + REVOKE ALL FROM PUBLIC. Only the `app_admin` role can read/write.
3. **Temporal isolation**: `purge_after` defaults to `now() + 90 days`. The `purge_expired_credential_requests()` function, called by pg_cron, permanently destroys the email↔commitment link.

**Why not a separate database?** A separate schema achieves logical isolation while keeping FK references to `semaphore_groups` intact. A separate database would break FKs and complicate transactions.

---

## 7. Privacy Invariants Summary

| Invariant | Enforcement |
|---|---|
| No `user_id` on content tables | Schema design — columns simply don't exist |
| Nullifier scope separation | `external_nullifier` TEXT field with different patterns per action type |
| **Group-scoped external_nullifier** | **Application-layer — scope MUST include group_id (see §7.1)** |
| Comment group consistency | Application-layer validation during ZKP verification |
| State consistency (deleted, moderated) | CHECK constraints on every relevant table |
| Onboarding isolation | Separate schema + RLS + auto-purge |

### 7.1 Group-Scoped External Nullifier (Critical)

The `external_nullifier` (scope) passed to Semaphore's nullifier hash function **must always include the `group_id`**. Without it, the same user acting in two different groups produces the **same `nullifier_hash`**, which creates a cross-group correlation attack:

```
scope = "post_creation_2024-02-08"  (BAD — no group_id)

Group A row: nullifier_hash = hash(secret, scope) = 0xABC
Group B row: nullifier_hash = hash(secret, scope) = 0xABC  ← SAME!
```

A DBA can query `GROUP BY nullifier_hash HAVING COUNT(DISTINCT group_id) > 1` and discover that the same person posted in both groups — violating unlinkability.

**Fix**: Include `group_id` in the scope so the hash inputs differ:

```
scope_A = "post_creation_{group_A_hex}_2024-02-08"
scope_B = "post_creation_{group_B_hex}_2024-02-08"

nullifier_A = hash(secret, scope_A) = 0xABC
nullifier_B = hash(secret, scope_B) = 0xDEF  ← different, un-correlatable
```

**Why not fix with `UNIQUE(group_id, nullifier_hash, external_nullifier)`?** That constraint would allow both rows to INSERT (fixing the blocking problem), but the identical `nullifier_hash` values would still be visible in the data. Constraints control insertion, not data visibility. The fix must be at the cryptographic input level.

**Required scope formats** (enforced by the application layer):

| Action | Scope format |
|---|---|
| Post creation | `post_creation_{group_id_hex}[_{date}]` |
| Comment | `comment_{group_id_hex}_{post_uuid}[_{random}]` |
| Vote | `vote_{group_id_hex}_{target_type}_{target_uuid}` |

---

## 8. Index Strategy

### Critical indexes (query-path dependent):

| Table | Index | Purpose |
|---|---|---|
| `posts` | `(group_id, created_at DESC)` | Feed pagination |
| `posts` | Partial: `WHERE approved AND NOT deleted` | Trending sort by `vote_score` |
| `comments` | `(post_id, created_at DESC)` | Comment thread loading |
| `moderation_queue` | Partial: `WHERE status='pending'` | Moderator dashboard |
| `credential_requests` | `(purge_after)` | Nightly purge job |

### Redundant indexes intentionally omitted

PostgreSQL automatically creates a B-tree index for every UNIQUE constraint. The following explicit indexes were removed because they exactly duplicate UNIQUE constraint indexes:

| Omitted index | Covered by UNIQUE constraint |
|---|---|
| `(identity_commitment)` on `semaphore_members` | `uq_semaphore_members_commitment` |
| `(group_id, leaf_index)` on `semaphore_members` | `uq_semaphore_members_group_leaf` |
| `(group_id, level, index_at_level)` on `merkle_tree_nodes` | `uq_merkle_tree_node_position` |
| `(group_id, date)` on `analytics_daily_snapshots` | `uq_analytics_group_date` |

Each redundant index would double write overhead for that column set with zero query benefit.

### Why partial indexes?

Partial indexes are used where the majority of queries filter on a constant predicate (e.g. `WHERE ai_moderation_status = 'approved' AND NOT is_deleted`). They are smaller, faster, and reduce write amplification compared to full indexes because they only index the relevant subset of rows.

---

## 9. DB vs Application Layer — Trigger Policy

**Principle**: Only security invariants and mechanical bookkeeping belong in DB triggers. Business logic, workflow orchestration, and cross-table validations belong in the application layer.

### Kept in DB (3 triggers)

| Trigger | Why |
|---|---|
| `set_updated_at()` | Mechanical bookkeeping. Universal pattern, zero logic. |
| `prevent_depth_change()` | Cryptographic invariant. Depth immutability is a security guarantee — the app must not be trusted to "just not update it." |
| `prevent_audit_mutation()` | Security invariant. The entire point is that even buggy app code cannot mutate audit logs. |

### Moved to application layer (4 triggers removed)

| Removed trigger | Why moved |
|---|---|
| `votes_after_insert/delete()` | Hidden cross-table UPDATEs; couples 3 tables at DB level; bulk overhead |
| `modqueue_propagate_decision()` | Workflow orchestration (approve → update post); needs extensibility for notifications, multi-phase review |
| `enforce_comment_group_consistency()` | Redundant with ZKP verification; hidden SELECT per insert; splits validation across two layers |

---

## 10. PostgreSQL Version

**PostgreSQL 17** is recommended (released Sep 2024, 1.5 years of stable production use):
- `GENERATED ALWAYS AS … STORED` for `vote_score`
- Native `gen_random_uuid()` without requiring pgcrypto (though we still use pgcrypto for `crypt()`)
- Improved `MERGE` for upsert patterns
- Better parallel query planning for analytics aggregations
- Improved incremental sort and memory management
- All major managed services (Supabase, Neon, RDS, Cloud SQL) fully support it

PostgreSQL 18 (Sep 2025) is also viable but only ~5 months old. For a greenfield project, 17 gives the best stability-to-features ratio. All schema features used here are compatible with 17+.
