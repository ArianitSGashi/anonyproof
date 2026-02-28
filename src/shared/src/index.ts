// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok";
  service: "backend";
  timestamp: string;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

export interface ApiError {
  message: string;
  code: string;
}

// ─── Blind Signature Credential Flow ─────────────────────────────────────────

/**
 * Server's RSA public parameters for blind signatures.
 * Client needs these to blind their commitment before sending.
 */
export interface BlindSignaturePublicParams {
  n: string; // RSA modulus in hex
  e: string; // RSA public exponent in hex
}

/**
 * Phase 1 Request: Student sends blinded commitment + university email.
 * Server NEVER sees the real commitment.
 */
export interface BlindCredentialRequest {
  universityEmail: string;
  groupId: string; // hex-encoded 32-byte group_id
  blindedCommitment: string; // hex-encoded blinded commitment
}

/**
 * Phase 1 Response: Request acknowledged, pending admin approval.
 */
export interface BlindCredentialRequestResponse {
  requestId: string;
}

/**
 * Phase 1 Admin Approval Response: Blind signature issued.
 * Delivered to the student so they can unblind it client-side.
 */
export interface BlindCredentialApprovalResponse {
  requestId: string;
  blindSignature: string; // hex-encoded blind signature
}

/**
 * Phase 2 Request: Student submits real commitment + unblinded signature.
 * Server verifies the signature is valid but CANNOT link to any email.
 */
export interface CommitmentRegistrationRequest {
  groupId: string; // hex-encoded 32-byte group_id
  commitment: string; // hex-encoded 32-byte real identity_commitment
  signature: string; // hex-encoded unblinded signature
}

/**
 * Phase 2 Response: Commitment registered in the Merkle tree.
 */
export interface CommitmentRegistrationResponse {
  leafIndex: number;
}

/**
 * Pending credential request (admin view).
 * Shows email + group info, but NOT the blinded commitment value.
 */
export interface PendingCredentialRequest {
  id: string;
  universityEmail: string;
  groupId: string; // hex-encoded
  status: string;
  createdAt: string; // ISO-8601
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Query parameters for paginated endpoints. */
export interface PaginationParams {
  page?: number; // 1-indexed, default 1
  limit?: number; // items per page, default 20
}

/** Standard paginated response wrapper. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Groups ──────────────────────────────────────────────────────────────────

export interface GroupResponse {
  id: string;
  groupId: string; // hex
  name: string;
  description: string | null;
  depth: number;
  memberCount: number;
  createdAt: string; // ISO-8601
}

export interface CreateGroupRequest {
  name: string;
  description?: string;
  depth: number;
}

// ─── ZK Proofs ───────────────────────────────────────────────────────────────

/** Serialised ZKP proof fields included in content creation requests. */
export interface ZkProof {
  nullifierHash: string; // hex — 32 bytes
  externalNullifier: string; // scope string
  proof: string; // serialised snark proof
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export interface CreatePostRequest {
  groupId: string; // hex
  content: string;
  proof: ZkProof;
}

export interface PostResponse {
  id: string;
  groupId: string; // hex
  content: string;
  moderationStatus: string;
  upvotes: number;
  downvotes: number;
  voteScore: number;
  commentCount?: number;
  createdAt: string; // ISO-8601
}

// ─── Comments ────────────────────────────────────────────────────────────────

export interface CreateCommentRequest {
  postId: string;
  parentCommentId?: string;
  content: string;
  proof: ZkProof;
}

export interface CommentResponse {
  id: string;
  postId: string;
  parentCommentId: string | null;
  content: string;
  moderationStatus: string;
  upvotes: number;
  downvotes: number;
  voteScore: number;
  createdAt: string; // ISO-8601
}

// ─── Votes ───────────────────────────────────────────────────────────────────

export interface VoteRequest {
  postId?: string;
  commentId?: string;
  voteType: "upvote" | "downvote";
  proof: ZkProof;
}

export interface VoteResponse {
  id: string;
  voteType: "upvote" | "downvote";
  createdAt: string; // ISO-8601
}

// ─── Moderation ──────────────────────────────────────────────────────────────

export interface ModerationQueueItem {
  id: string;
  contentType: "post" | "comment";
  contentId: string;
  content: string;
  toxicityScore: number;
  flaggedCategories: unknown;
  status: string;
  createdAt: string; // ISO-8601
}

export interface ModerationDecision {
  queueItemId: string;
  decision: "approved" | "rejected" | "escalated";
  notes?: string;
}

