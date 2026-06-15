import fetch from "node-fetch";

async function run() {
  const token = "invalid";
  const userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" },
  });
  console.log(userResponse.headers.get("X-OAuth-Scopes"));
}
run();
