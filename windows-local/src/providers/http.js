'use strict';

/** Error carrying the HTTP status so callers can decide whether to retry or fall back. */
class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** POSTs JSON and returns parsed JSON. Redacts nothing, so never log request headers. */
async function postJson({ url, headers, body, fetchImplementation = fetch, timeoutMilliseconds = 60000 }) {
  let response;
  try {
    response = await fetchImplementation(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMilliseconds),
    });
  } catch (error) {
    const host = new URL(url).host;
    const reason = error.name === 'TimeoutError' ? 'timed out' : 'could not connect';
    throw new Error(`Request to ${host} ${reason}. Check your internet connection or firewall (or that Ollama is running).`);
  }
  const responseText = await response.text();
  if (!response.ok) throw new HttpError(`HTTP ${response.status}: ${responseText.slice(0, 300)}`, response.status);
  return JSON.parse(responseText);
}

module.exports = { HttpError, RETRYABLE_STATUSES, postJson, sleep };
