import { db } from "./apps/api/src/db";
import { oauthAccounts } from "@guildserver/database";
import { eq } from "drizzle-orm";

async function run() {
  const account = await db.query.oauthAccounts.findFirst({
    where: eq(oauthAccounts.provider, "github"),
  });
  
  if (!account) {
    console.log("No GitHub account found in DB");
    return;
  }
  
  console.log("Found token with scope:", account.scope);
  
  const response = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
    headers: {
      Authorization: `token ${account.accessToken}`,
      Accept: "application/vnd.github.v3+json",
    },
  });
  
  console.log("Status:", response.status, response.statusText);
  if (!response.ok) {
    const text = await response.text();
    console.log("Error body:", text);
    return;
  }
  
  const repos = await response.json();
  console.log(`Found ${repos.length} repos`);
  if (repos.length > 0) {
    console.log("First repo:", repos[0].full_name);
  }
}

run().catch(console.error).finally(() => process.exit(0));
