# Chat Sync to GitHub

Pushes your Lumiverse chats to a private GitHub repo as readable Markdown, so
ChatGPT or Codex can read them.

- Each chat overwrites its own file: `chats/<chat-name>-<id>.md`
- The most recently pushed chat is also copied to `chats/latest.md`
- Auto-push waits until the chat has been quiet (default 5 minutes), so you get
  one commit per session instead of one per reply
- **Push this chat now** button in the drawer tab

## Setup

1. On GitHub, create a **private** repo for the chats (e.g. `lumiverse-chats`).
   Tick "Add a README" so it has a `main` branch.
2. Make a fine-grained token: GitHub → Settings → Developer settings →
   Fine-grained tokens → Generate. Repository access: *Only select
   repositories* → your chats repo. Permissions: **Contents: Read and write**.
3. Install this extension in Lumiverse from its GitHub URL, enable it, and
   grant **cors_proxy** and **generation** (admin approval needed).
4. Open the **Chat Sync** drawer tab, enter the repo (`owner/name`), paste the
   token, and Save. The token is kept in Lumiverse's encrypted secret store.

## Permissions

| Permission | Why |
| --- | --- |
| `chats` | Find the chat you have open |
| `chat_mutation` | Read the chat's messages (Lumiverse puts message reading under this one; nothing is changed) |
| `generation` | Notice when an AI reply finishes, for auto-push |
| `cors_proxy` | Send the file to api.github.com |
| `ui_panels` | The drawer tab |
