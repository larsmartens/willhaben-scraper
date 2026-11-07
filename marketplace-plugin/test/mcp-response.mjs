export async function readMcpResponse(response) {
  if (!response.headers.get("content-type")?.startsWith("text/event-stream")) return response.json();
  const data = (await response.text()).split("\n")
    .filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  const result = data.find(message => Object.hasOwn(message, "result") || Object.hasOwn(message, "error"));
  if (!result) throw new Error("MCP stream ended without a terminal response");
  return result;
}
