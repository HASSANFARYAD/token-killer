const TOKEN_ACCURACY = new Set(['exact', 'estimated', 'unknown']);
const TOKEN_METHOD = new Set(['provider_reported', 'cli_metadata', 'compression_estimate', 'unknown']);

export function normalizeUsageEvent({
  source = 'vscode',
  tool = 'vscode-extension',
  eventType = 'llm_usage',
  sessionId,
  inputTokens = 0,
  outputTokens = 0,
  savedTokens = 0,
  accuracy = 'unknown',
  method = 'unknown',
  metadata = {}
} = {}) {
  return {
    source,
    tool,
    event_type: eventType,
    session_id: sessionId || null,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      saved: savedTokens,
      accuracy: TOKEN_ACCURACY.has(accuracy) ? accuracy : 'unknown',
      method: TOKEN_METHOD.has(method) ? method : 'unknown'
    },
    metadata,
    prompt_stored: false,
    completion_stored: false,
    source_code_stored: false
  };
}

