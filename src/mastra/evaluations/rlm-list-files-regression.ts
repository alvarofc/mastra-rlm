import { mastra } from "../index";

type ListFilesArgs = {
  path?: unknown;
  maxDepth?: unknown;
  showHidden?: unknown;
  dirsOnly?: unknown;
};

async function run() {
  const agent = mastra.getAgent("rlmAgent");

  const result = await agent.generate("List files in the bucket root", {
    maxSteps: 2,
  });

  const calls = result.toolCalls || [];
  const customCalls = calls.filter(call => call?.payload?.toolName === "list_bucket_files");
  const builtinCalls = calls.filter(
    call => call?.payload?.toolName === "mastra_workspace_list_files"
  );

  if (customCalls.length === 0 && builtinCalls.length === 0) {
    throw new Error("Regression failed: no file listing tool call was emitted");
  }

  if (builtinCalls.length > 0) {
    throw new Error(
      "Regression failed: mastra_workspace_list_files should be disabled to avoid dirsOnly validation errors"
    );
  }

  for (const call of customCalls) {
    const args = (call.payload.args || {}) as ListFilesArgs;
    assertType("path", args.path, "string");
    assertType("maxDepth", args.maxDepth, "number");
    assertType("showHidden", args.showHidden, "boolean");
    assertType("dirsOnly", args.dirsOnly, "boolean");
  }

  console.log("PASS: list_bucket_files used with complete listing arguments");
}

function assertType(name: string, value: unknown, type: "string" | "number" | "boolean") {
  if (typeof value !== type) {
    throw new Error(
      `Regression failed: expected '${name}' to be ${type}, got ${typeof value}`
    );
  }
}

run().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
});
