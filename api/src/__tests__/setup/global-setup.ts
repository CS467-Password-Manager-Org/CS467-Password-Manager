import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

// api/src/__tests__/setup -> repo root is four levels up.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB_INIT_DIR = path.resolve(HERE, "../../../../db/init");

// Must match the tag docker-compose.yml deploys, so tests exercise the same major.
const POSTGRES_IMAGE = "postgres:16-alpine";

export default async function setup(project: TestProject) {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  )
    .withDatabase("app")
    .withUsername("app")
    .withPassword("app")
    .start();

  const databaseUrl = container.getConnectionUri();
  await applySchema(databaseUrl);

  // Workers are separate processes, so the URI is handed over explicitly.
  project.provide("databaseUrl", databaseUrl);

  return async () => {
    await container.stop();
  };
}

// Applies db/init/*.sql in lexical order, the same order the Postgres
// entrypoint uses for /docker-entrypoint-initdb.d in docker-compose.yml.
async function applySchema(connectionString: string): Promise<void> {
  const files = (await readdir(DB_INIT_DIR))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(path.join(DB_INIT_DIR, file), "utf8");
      // No parameters, so pg uses the simple query protocol and the server
      // accepts the whole file as one multi-statement batch.
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}
