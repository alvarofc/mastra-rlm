import { Workspace, LocalSandbox } from "@mastra/core/workspace";
import { S3Filesystem } from "@mastra/s3";

const accountId = process.env.R2_ACCOUNT_ID;

const filesystem = new S3Filesystem({
  bucket: "mastra-rlm",
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  forcePathStyle: true,
});

export const workspace = new Workspace({
  id: "rlm",
  name: "rlm",
  sandbox: new LocalSandbox({
    workingDirectory: "./workspace",
  }),
  bm25: true,
  skills: [],
  tools: {
    mastra_workspace_list_files: {
      enabled: false,
    },
  },
  filesystem,
});
