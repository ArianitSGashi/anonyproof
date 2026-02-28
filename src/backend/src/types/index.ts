/**
 * Types barrel export.
 *
 * Re-exports all typed database interfaces, table types, enum types,
 * and convenience aliases (Selectable/Insertable/Updateable variants).
 */

export type {
  // Core
  Database,
  JsonValue,

  // Enum types
  ModerationStatus,
  VoteType,
  AdminRole,
  ModerationQueueStatus,
  CredentialRequestStatus,

  // Table interfaces (raw column types)
  SemaphoreGroupsTable,
  SemaphoreMembersTable,
  MerkleTreeNodesTable,
  PostsTable,
  CommentsTable,
  VotesTable,
  AdminUsersTable,
  ModerationQueueTable,
  AdminActionsTable,
  AnalyticsDailySnapshotsTable,
  CredentialIssuanceRequestsTable,
  AiModelVersionsTable,

  // Selectable (SELECT row shape)
  SemaphoreGroup,
  SemaphoreMember,
  MerkleTreeNode,
  Post,
  Comment,
  Vote,
  AdminUser,
  ModerationQueueEntry,
  AdminAction,
  AnalyticsDailySnapshot,
  CredentialIssuanceRequest,
  AiModelVersion,

  // Insertable (INSERT row shape — Generated columns optional)
  NewSemaphoreGroup,
  NewSemaphoreMember,
  NewMerkleTreeNode,
  NewPost,
  NewComment,
  NewVote,
  NewModerationQueueEntry,
  NewAdminUser,
  NewAdminAction,
  NewAnalyticsDailySnapshot,
  NewCredentialIssuanceRequest,
  NewAiModelVersion,

  // Updateable (UPDATE row shape — all columns optional)
  SemaphoreGroupUpdate,
  SemaphoreMemberUpdate,
  MerkleTreeNodeUpdate,
  PostUpdate,
  CommentUpdate,
  ModerationQueueEntryUpdate,
  AdminUserUpdate,
  AnalyticsDailySnapshotUpdate,
  CredentialIssuanceRequestUpdate,
  AiModelVersionUpdate,
} from "./database.js";
