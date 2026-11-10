# Shared review

Share a prototype, or a worker's live app, with several people behind sign-in. They comment on the spot of the page they mean, or on the review as a whole, each under their own name, with files and voice notes if they like. When you close the review, the link goes down and the comment threads you choose (every one, unless you untick some) go to Firstmate as one note about the task, for its worker.

The plugin is bundled with Wheelhouse in the installed-plugin format and is off until you turn it on in **Settings → Plugins → Shared review**. Nothing in it names a host, a domain or an account: where reviews go live, how people sign in, who sends their sign-in email and which secrets it uses (by wh-vault name) are all settings.

```
.wheelhouse-plugin/plugin.json   the manifest: a Reviews page, a task section, the feedback capability, the desk service, the settings
wheelhouse/server/index.js       providers and the desk service's resolver (reads only)
wheelhouse/ui/index.js           <shared-review-page> and <shared-review-task>
review/                          the review server, the desk and the CLI (plain Node 22, no dependencies)
deploy/                          a container image, a Kubernetes manifest, a docker-over-SSH script and a TLS proxy example
demo/                            a sample prototype, a stand-in dev server and a script that runs the whole thing on one computer
```

![A reviewer's view: the prototype with numbered pins where people commented, and the comments beside it](../../docs/screenshots/plugins/shared-review-reviewer.png)

![Commenting on a live app under review: in comment mode a click on the app opens a comment on that spot instead of reaching it](../../docs/screenshots/plugins/shared-review-comment.png)

![A task's Shared review section in Wheelhouse: a review live on the review server, with a live thumbnail of the app, its link, passcode and comments](../../docs/screenshots/plugins/shared-review-task.png)

![The Reviews page: each open review as a card with a live thumbnail of the prototype, its task, state, comments, link and actions](../../docs/screenshots/plugins/shared-review-cards.png)

## How it works

There are two programs, both in `review/`:

- **The review server** holds reviews, reviewers' sessions and their comments, and serves each review's prototype to signed-in reviewers. You deploy it once, to any machine or cluster that can serve HTTPS (see [Deploying a review server](#deploying-a-review-server)).
- **The review desk** runs on your computer, on loopback only. Wheelhouse starts it when you click **Launch** (it is the plugin's companion service). It runs a review server of its own for local previews, connects live apps, reaches your deployed review server with the owner token, and answers the plugin's pages.

A review goes through three steps:

1. **Local preview.** Every review starts on the desk's own server, reachable only from your computer, so you can check it first. Start one with **Share for review** on any live preview in Wheelhouse (a preview box in the Firstmate chat, or a task's **Live preview** tab), from a task's **Shared review** section, or have Firstmate or a worker run `node <wheelhouse>/plugins/shared-review/review/main.mjs start …` (see [Commands](#commands)).
2. **Live.** Nothing goes live until you say so: **Go live on review.example.com…** on the review (or `go-live <id>`, which Firstmate runs only on your word) moves it to your review server with the comments so far. It gets a new link and passcode; the local preview closes.
3. **Closed.** **Close…** lists the review's threads, each with a checkbox, and **Close and send _n_ threads to Firstmate** sends the ticked ones to Firstmate first, as one note about the task, and then takes the link down: the prototype's files, every session and every unused sign-in link are deleted, and live-app traffic stops. Attachments and voice notes go with it: they are deleted from the review server when it closes. Every comment, sent or not, stays on your computer in a bundle file (`bundles/<id>.json` in the desk's folder) with everything about each one (an attachment by its name, type, size and, for a voice note, length), and is then dropped from the review server.

### Choosing what to send

**Close…** shows one checkbox per thread, with who started it, the spot it points at (and its page), how many replies it has and its first line. Every thread is ticked at first; **Select all** and **Select none** tick or untick them all, and the send button counts the ticked ones. Only the ticked threads, with their replies, go into the note to Firstmate. The others go nowhere: they stay in the bundle, marked unsent, and are not offered again as late comments.

With no thread ticked, the send button is off and the dialog says so; **Close without sending** takes the link down and keeps every comment in the bundle, marked unsent. **Cancel** leaves the review open.

### Summarising the comments into points

Comments from several people often repeat each other or wander. Under the threads, **Summarise into points** has Wheelhouse's preview helper (the same engine a task's Live preview talks feedback through with) tidy the ticked threads into clear points for the worker: one change each, merging threads that ask the same thing and leaving out chat that asks for nothing. Each point has a checkbox, all ticked at first (with **Select all** and **Select none**), its words in a box you can edit, where it points and which threads (by number) it came from.

**Close and send _n_ points to Firstmate** then sends the ticked points, as edited, in place of the threads' comments, as the same one note about the task. The threads the sent points came from are marked sent in the bundle; a ticked thread that only unticked points came from is kept back, marked unsent, like an unticked one. Changing which threads are ticked puts the points aside (summarise again); **Send the threads as they are** drops them and goes back to sending the threads' comments.

The original comments always stay in the bundle exactly as written; the points that were sent are kept beside them, as `summary` (`{ at, points: [{ text, points, threads }] }`).

The summary is optional. When the helper cannot answer (Claude Code is not installed, say, or it fails or takes too long), the dialog says why and the threads are sent as they are, as without it. The helper sends nothing itself and sees only the task's id and title and the threads' text and where they point; see [docs/plugins.md](../../docs/plugins.md#summarising-a-list-before-it-is-sent).

In the bundle, every thread and every reply carries `"sent": true` or `"sent": false`: whether it reached Firstmate. A reply that came in after its thread was sent stays `false` until it is sent with **Send them to Firstmate**.

### What you see in Wheelhouse

**Share for review** sits on every live preview Wheelhouse shows: the preview boxes under Firstmate's replies (a task's preview, or any preview Firstmate links, such as one it forwarded from a second mate) and a task's **Live preview** tab. One click starts a review of that live app, as a local preview, about the preview's task when it has one; the button then shows the review's state, **Open** and **Copy link** (the link with the passcode in it), and, once a review server is set, **Go live…**, which asks once more before it moves the review there. A preview that already has an open review shows that review instead. With the desk not running, the button launches it first (and opens the Reviews page); click it again once it is up. A remote second mate's preview is reviewed through the forward Wheelhouse opened for it, so keep its preview open in Wheelhouse while people review it.

The **Reviews** page shows each review as a card, open ones first: a live thumbnail of the prototype (click it to open the review in a new tab), its title, task and state (local preview, live, or closed), its comment count and who commented, its link and passcode, the latest comments, and **Go live…** or **Close…**. A task's **Shared review** section shows its reviews the same way, with every comment.

The thumbnail is the prototype itself, running, scaled down: a sandboxed frame that loads once it scrolls into view and takes no clicks of its own. The desk serves it from the review's source (its folder, or the live app on this computer), on a loopback port of its own for each review; the page asks the desk for a one-time ticket with the desk key, the ticket becomes a session cookie for that port, and only Wheelhouse's page may frame it. So it shows only where Wheelhouse is open on the computer running the desk; opened from elsewhere, the card says so and still opens the review.

### What reviewers see

The share link (`https://review.example.com/_review/<id>`) asks for a name and the passcode you hand out, or for an email address that gets a sign-in link. **Copy link** copies it with the passcode in its fragment (`…/_review/<id>#p=<passcode>`), so reviewers who open that link add only their name: the sign-in page takes the passcode out of the address bar before anything else, fills it in, and posts it as a typed one (the same checks and limits). A link without it asks for the passcode as before. Signed in, they see the prototype in a frame with the comments beside it. **Comment** (or the C key) turns on comment mode: the next click on the prototype does not reach it but opens a comment on that spot. Each comment is kept with the page's path, the element (a CSS selector, and where inside it, as fractions of its box), the spot on the page as a fallback, and the element in plain words (`the “Pay now” button`), the way Wheelhouse's preview names what you point at. Pins show where each comment is; comments on other pages have **Go there**. Others' comments appear within a few seconds, and anyone can reply.

Not everything is about one spot: **On the whole review**, at the top of the comments, starts a thread about the review as a whole, without a pin. It takes replies like any other.

Every comment and reply can carry up to 4 attachments:

- **Files** (**Attach**): pictures (PNG, JPEG, GIF, WebP) shown in place, sound and video (MP3, M4A, WAV, Ogg, WebM, MP4) with a player, and PDFs, text, CSV, Markdown and JSON as downloads. At most 10 MB a file and 100 MB a review.
- **Voice notes** (**Record**): recorded in the browser (it asks for the microphone), up to 5 minutes and 5 MB, and played back in place. There is no transcript: Wheelhouse's dictation uses the browser's speech service, which sends audio to a third party, so voice notes are not transcribed; say the gist in words too if Firstmate should act on it.

Whoever wrote a comment can **Edit** its words and attachments, or **Delete** it (a comment others have replied to stays; edit it instead). That is checked by the server, against the sign-in that wrote it: the same browser's sign-in, or, for email sign-in, the same address. Signing in again with the passcode makes a new sign-in, so earlier comments can no longer be changed from it. You, the owner, can delete any comment, with its replies, from the review in Wheelhouse (**Delete** under it).

### What Firstmate gets

One note about the task (`Re: <task>`), written by Wheelhouse through the feedback capability every plugin's feedback list uses, so the chat shows it as your card and it counts as a change asked on the task:

```
Feedback for demo-checkout (Checkout prototype), sent together from the “Shared review” plugin (shared-review), about the shared review “Checkout prototype” (5 comments from Ana, Ben and Cy):
1. Ana: The Pay now button should say the amount, so people know what they are paying. — Ben replied: Agreed, and make it a little taller on phones.
   Points at: the “Pay now” button on / (50% across, 50% down it)
2. Ben: Promo codes are rare for us: tuck this behind a “Have a code?” link.
   Points at: the “Promo code” box on / (20% across, 70% down it)
…

Firstmate: pass these to this task’s worker, the same task (start no new one). You may add notes of your own, marked as yours.
```

![The Firstmate chat: the closed review's comments as one Shared review feedback card about the task, sent to Firstmate](../../docs/screenshots/plugins/shared-review-firstmate.png)

Each ticked thread is one line, its replies folded in (or, after **Summarise into points**, each ticked point is one line). A comment on the whole review points at “the review as a whole (not one spot)”. Attachments are named, never sent: `[attached: checkout.png (120 KB); voice note, 0:42]`. The list keeps to Wheelhouse's limits (30 lines of 500 characters, and Firstmate's 16 KiB note): a long review is shortened, and its last line names the bundle file, which has every comment in full with its selector, position and page. A review that is not about a task is closed without a note; its comments stay in its bundle.

The desk remembers which comments reached Firstmate, so none is sent twice, and which threads you held back. A comment that arrives between the send and the takedown, in a thread you did not hold back, is caught: the review says so, with **Send them to Firstmate**. Until its comments are dropped from the review server, a closed review also offers to take them off without sending.

## Setting it up

1. Turn it on in **Settings → Plugins → Shared review**.
2. Open **Reviews** in the menu (or a task's **Shared review** section) and click **Launch the review desk**.

That is all a local preview needs. To share reviews with people on other computers, deploy a review server and fill in the settings.

### Settings

All optional, in **Settings → Plugins → Shared review** (saved to `plugins.json`):

| Setting                   | Key            | What it is                                                                                                                        |
| ------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Review server address     | `reviewServer` | The public address reviewers open, such as `https://review.example.com`. Empty keeps reviews on your computer. It must use https. |
| Owner token (vault name)  | `ownerToken`   | The wh-vault secret holding the server's owner token (default `SHARED_REVIEW_OWNER_TOKEN`).                                       |
| How reviewers sign in     | `signIn`       | `passcode` (default), `email` or `both`, for reviews once they go live. Local previews always use a passcode.                     |
| Who may sign in by email  | `invite`       | Addresses, or `@example.com` for a whole domain, that new reviews invite.                                                         |
| Review host (SSH)         | `reviewHost`   | Where the docker-over-SSH deploy installs the server, such as `deploy@review-host.example.com`.                                   |
| Email sender              | `emailFrom`    | The From address on sign-in links, such as `Reviews <reviews@example.com>`.                                                       |
| Email server (vault name) | `smtpUrl`      | The wh-vault secret holding the SMTP address sign-in links go through (default `SHARED_REVIEW_SMTP_URL`).                         |

### Secrets, by name

The desk needs the owner token to reach your review server. It never sits in a file of yours: store it in [wh-vault](../../docs/vault.md) and grant it to one project, and Wheelhouse starts the desk under `wh-vault run --only <name>`, in that project's clone, so the value is in the desk's environment and nowhere else.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))" | wh-vault set SHARED_REVIEW_OWNER_TOKEN
wh-vault grant SHARED_REVIEW_OWNER_TOKEN <a project>
```

Without a grant, or without wh-vault (which needs macOS today), the desk starts without the token and keeps reviews on your computer; the Reviews page says why. To start it by hand with the token, run the command the Reviews page shows when Launch is not possible.

## Commands

Firstmate and workers start and manage reviews with `review/main.mjs` (in Wheelhouse's package: `plugins/shared-review/review/main.mjs`). Every command but `serve` talks to the running desk, which it finds through `desk.json` in the desk's folder (`--state`, else `$WH_REVIEW_STATE`, else Wheelhouse's state folder's `plugins/shared-review`). Add `--json` for machine-readable output.

```sh
main.mjs start --task <id> --live http://127.0.0.1:5173    # a worker's dev server (on this computer only)
main.mjs start --task <id> --static ./dist [--spa]           # a folder of static files (--spa: unknown paths show index.html)
             [--title <title>] [--start /checkout] [--email ana@example.com,@example.org]
main.mjs list [--task <id>]                                  # reviews, links, passcodes, comments
main.mjs go-live <id>                                        # only once the captain agrees
main.mjs close <id>                                          # take the link down; print the bundle as the note
main.mjs show <id>                                           # the comments, or the bundle once closed
```

`start` prints the local preview's link and passcode, and the link that carries the passcode; a worker reports the link as a preview (`preview <link>`) like any other. `close` from a terminal hands the note to whoever ran it, not to Firstmate's inbox: the captain closes from Wheelhouse to send it there.

## Deploying a review server

The server is one folder of plain Node with no dependencies, built into one small image by `deploy/Dockerfile`. It keeps its state in one folder (`/data` in the image), so run one copy of it. Configure it with these variables:

| Variable                | What it is                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `REVIEW_PUBLIC_URL`     | The address reviewers open (required).                                                    |
| `REVIEW_OWNER_TOKEN`    | The owner token, at least 24 characters (required; a secret).                             |
| `REVIEW_LISTEN`         | Where it listens (`0.0.0.0:8080` in the image; `127.0.0.1:8080` otherwise).               |
| `REVIEW_DATA_DIR`       | Its data folder (`/data` in the image).                                                   |
| `REVIEW_EMAIL_FROM`     | The From address on sign-in links; with `REVIEW_SMTP_URL`, it turns email sign-in on.     |
| `REVIEW_SMTP_URL`       | `smtps://user:password@smtp.example.com:465`, or `smtp://…:587` with STARTTLS (a secret). |
| `REVIEW_TRUST_PROXY`    | `1` behind a TLS proxy or ingress that sets X-Forwarded-For.                              |
| `REVIEW_SESSION_SECRET` | A key for signing sessions; without it one is made once and kept in the data folder.      |

`deploy/review.env.example` has them as an env file. Choose any of these:

- **Docker over SSH.** `deploy/ssh-deploy.sh` builds the image here, copies it to the host, writes the env file there through SSH's standard input (mode 0600) and starts the container on the host's loopback. Put a TLS proxy in front (`deploy/Caddyfile.example`). The Reviews page shows the exact command from your settings; with placeholders it reads:

  ```sh
  wh-vault run --only SHARED_REVIEW_OWNER_TOKEN -- env \
    REVIEW_SSH_HOST=deploy@review-host.example.com REVIEW_PUBLIC_URL=https://review.example.com \
    REVIEW_OWNER_TOKEN_NAME=SHARED_REVIEW_OWNER_TOKEN plugins/shared-review/deploy/ssh-deploy.sh
  ```

  `--dry-run` says what it would do without doing it. For email sign-in, add `SHARED_REVIEW_SMTP_URL` to `--only` and set `REVIEW_EMAIL_FROM`.

- **Kubernetes.** `deploy/kubernetes.yaml` has a namespace, a ConfigMap, a volume, a one-replica Deployment (non-root, read-only root filesystem), a Service and an Ingress with TLS, every value of yours marked `REPLACE`. Its header shows how to create the secret from the vault without typing a value.

- **Anything else that runs a container or Node 22**: `node review/main.mjs serve` with the variables above, behind HTTPS.

Then set **Review server address** to the server's address and relaunch the desk. The Reviews page says whether it reaches the server (**ready**), and which sign-in methods it offers.

## Security

- **Unlisted and private.** Each review's address carries a random 128-bit id; nothing lists reviews; every page and prototype file needs a signed-in session for that review. Responses are marked `noindex` and are not cached.
- **Sessions** are random, signed with the server's key, kept server-side and sent as `HttpOnly`, `SameSite=Lax` cookies (`Secure` over https), one per review, for up to 14 days or until the review closes.
- **Passcodes** are random (about 59 bits) unless you choose one, kept only as salted scrypt hashes, compared in constant time, and limited to 5 wrong tries per address and 30 per review in 15 minutes. A link that carries one has it in the fragment, which browsers never send to a server or in a Referer; the sign-in page removes it from the address at once and keeps it nowhere but the form. Anyone with that link can sign in, as anyone with the link and the passcode could.
- **Email sign-in links** go only to invited addresses or domains, work once, for 15 minutes, and carry their token in the address's fragment, which never reaches a server log; the landing page posts it only when the reviewer clicks **Continue**, so mail scanners do not use it up. The answer to asking for a link is the same whether or not the address is invited.
- **Thumbnails** are served by the desk on loopback only, from a port of its own per review that answers only to its own address on this computer, and only with a session that a one-time, two-minute ticket (asked for with the desk key) started. Their frames are sandboxed, and only the page that asked may frame them. They follow the same rules as uploads: no hidden files, no `node_modules`, nothing outside the folder; the review's own cookies never reach a live app. Closing a review closes its port.
- **Live apps** are reachable only through a signed-in review: the desk connects out to the server, so the dev server needs no open port, and only addresses on loopback can be reviewed. The review's own cookies are never passed to the app, and the app cannot set them.
- **Changes** from reviewers must come from the review's own pages (Origin checked); the owner API needs the owner token; the desk answers only on loopback, only to its key (kept in `desk.json`, readable only by you), and the plugin's pages get that key the way they get any provider value.
- **Comments are untrusted.** Their text is bounded, kept as text, and drawn as text everywhere (the review page, Wheelhouse, the note); the server's pages allow only their own scripts.
- **Attachments are untrusted.** Only the types listed above are taken, and only when their first bytes are that type (an HTML page named `.png` is refused); no SVG, HTML or script. They are size-bounded per file, per voice note and per review, served only to people signed in to that review (an upload not yet on a comment, only to its uploader), with their own type, `nosniff`, a `sandbox` policy that runs nothing, and as a download unless they are a picture, sound or video. Editing and deleting are checked on the server: only a comment's author, or you through the owner API.
- **Nothing logs a secret**: not the owner token, a passcode, a session or a sign-in link. A static prototype's hidden files and folders (`.env`, `.git`) and `node_modules` are never uploaded.
- **The prototype is trusted.** It runs on the review's own origin, as the review page does, so its scripts could act as a signed-in reviewer: review only prototypes you would open yourself.

## Limits

- A live app's requests and answers are whole: no WebSockets or streaming, so hot reload does not reach reviewers, who reload instead. Answers are at most 24 MB.
- A browser shows one review's prototype at a time: the prototype is served at the site's root, so absolute paths work, and the review last opened decides which. The review page notices when another one took over and offers to switch back.
- A static prototype holds at most 5,000 files and 200 MB (25 MB a file). A review holds at most 500 comments, and 100 MB of attachments (10 MB a file, 5 MB and 5 minutes a voice note, 4 on a comment).
- Voice notes are not transcribed (see [What reviewers see](#what-reviewers-see)). Recording needs a browser with MediaRecorder and a secure page (https, or this computer).
- One review server per deployment, one replica: its state is one folder.
- The plugin's pages reach the desk at its address on loopback, so its buttons and thumbnails work where Wheelhouse is opened on the same computer as the desk (at `127.0.0.1` or `localhost`). Opened from elsewhere (a forwarded port, another computer), the pages still show the reviews the providers read, and the commands still work.

## Trying it on one computer

`node plugins/shared-review/demo/run.mjs` starts a desk in a fresh folder, a stand-in dev server, a stand-in review server on loopback, and a review in each state: the sample prototype in `demo/prototype` as a local preview, the live app put live on the stand-in server, and the prototype's help page, closed. Ana and Ben sign in and comment on each, with one comment on the whole review carrying a picture and a stand-in voice note. It prints each open review's link, passcode and the link that carries it. Start Wheelhouse with `WH_REVIEW_STATE` set to the folder it names to see and close the reviews there.

See [docs/plugins.md](../../docs/plugins.md#shared-review) for how it fits Wheelhouse's plugins.
