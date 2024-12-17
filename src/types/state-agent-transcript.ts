export enum StateAgentTranscriptRole {
  BOT = "message.bot",
  HUMAN = "human",
  ACTION_FINISH = "action-finish",
  DEBUG = "debug",
}

export enum StateAgentDebugMessageType {
  ACTION_INVOKE = "action_invoke",
  ACTION_ERROR = "action_error",
  HANDLE_STATE = "handle_state",
  BRANCH_DECISION = "branch_decision",
  INVARIANT_VIOLATION = "invariant_violation",
}

interface BaseTranscriptEntry {
  role: StateAgentTranscriptRole;
  message: string;
  timestamp: string;
}

export type StateAgentTranscriptMessage = BaseTranscriptEntry & {
  role: StateAgentTranscriptRole.BOT | StateAgentTranscriptRole.HUMAN;
};

export type StateAgentTranscriptActionFinish = BaseTranscriptEntry & {
  role: StateAgentTranscriptRole.ACTION_FINISH;
  action_name: string;
  runtime_inputs: Record<string, unknown>;
};

interface BaseDebugEntry extends BaseTranscriptEntry {
  role: StateAgentTranscriptRole.DEBUG;
  type: StateAgentDebugMessageType;
}

export type StateAgentTranscriptActionInvoke = BaseDebugEntry & {
  type: StateAgentDebugMessageType.ACTION_INVOKE;
  message: "action invoked";
  state_id: string;
  action_name: string;
};

export type StateAgentTranscriptBranchDecision = BaseDebugEntry & {
  type: StateAgentDebugMessageType.BRANCH_DECISION;
  message: "branch decision";
  ai_prompt: string;
  ai_tool: Record<string, string>;
  ai_response: string;
  internal_edges: Array<Record<string, unknown>>;
  original_state: Record<string, unknown>;
};

export type StateAgentTranscriptActionError = BaseDebugEntry & {
  type: StateAgentDebugMessageType.ACTION_ERROR;
  action_name: string;
  raw_error_message: string;
};

export interface MemoryDependency {
  key: string;
  description: string;
}

export type StateAgentTranscriptHandleState = BaseDebugEntry & {
  type: StateAgentDebugMessageType.HANDLE_STATE;
  message: string;
  state_id: string;
  generated_label: string;
  memory_dependencies: MemoryDependency[] | null;
  memory_values: Record<string, unknown>;
  trigger?: string | null;
};

export type StateAgentTranscriptInvariantViolation = BaseDebugEntry & {
  type: StateAgentDebugMessageType.INVARIANT_VIOLATION;
  original_state?: Record<string, unknown> | null;
  extra_info?: Record<string, unknown> | null;
};

export type TranscriptEntry =
  | StateAgentTranscriptMessage
  | StateAgentTranscriptActionFinish
  | StateAgentTranscriptActionInvoke
  | StateAgentTranscriptActionError
  | StateAgentTranscriptHandleState
  | StateAgentTranscriptBranchDecision
  | StateAgentTranscriptInvariantViolation;

export interface StateAgentTranscript {
  version: "StateAgent_v0";
  entries: TranscriptEntry[];
}
