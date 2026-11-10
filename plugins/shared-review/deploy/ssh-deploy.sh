#!/usr/bin/env bash
# Deploy the shared review server to a machine you reach over SSH, with Docker.
#
# It builds the image here (deploy/Dockerfile), copies it to the host with
# `docker save | ssh host docker load`, writes the server's env file on the
# host through SSH's standard input (mode 0600, never on a command line), and
# (re)starts the container, published on the host's loopback only. Put a TLS
# proxy in front of it (deploy/Caddyfile.example).
#
# Run it under wh-vault, so the secrets reach it by name and nowhere else:
#   wh-vault run --only SHARED_REVIEW_OWNER_TOKEN -- env \
#     REVIEW_SSH_HOST=deploy@review-host.example.com \
#     REVIEW_PUBLIC_URL=https://review.example.com \
#     plugins/shared-review/deploy/ssh-deploy.sh
# (The Reviews page in Wheelhouse shows this command filled in from the plugin's settings.)
#
# Settings, from the environment:
#   REVIEW_SSH_HOST          user@host to deploy to (required)
#   REVIEW_PUBLIC_URL        the address reviewers open, https://... (required)
#   REVIEW_OWNER_TOKEN_NAME  the variable holding the owner token (default SHARED_REVIEW_OWNER_TOKEN)
#   REVIEW_EMAIL_FROM        the From address on sign-in links (only for email sign-in)
#   REVIEW_SMTP_URL_NAME     the variable holding the SMTP address (default SHARED_REVIEW_SMTP_URL; only for email sign-in)
#   REVIEW_PORT              the host's loopback port for the container (default 8080)
#   REVIEW_IMAGE             the image name (default wheelhouse-shared-review:<version>)
#   REVIEW_REMOTE_DIR        the folder on the host for the env file (default shared-review, under the SSH user's home)
#
# Options:
#   --dry-run   say what it would do, without any value, and do nothing
set -euo pipefail

dry=0
for arg in "$@"; do
	case "$arg" in
	--dry-run) dry=1 ;;
	-h | --help)
		sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'
		exit 0
		;;
	*)
		echo "ssh-deploy: unknown option $arg" >&2
		exit 2
		;;
	esac
done

here="$(cd "$(dirname "$0")" && pwd)"
plugin="$(dirname "$here")"
version="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$plugin/.wheelhouse-plugin/plugin.json" | head -n 1)"

host="${REVIEW_SSH_HOST:-}"
url="${REVIEW_PUBLIC_URL:-}"
token_name="${REVIEW_OWNER_TOKEN_NAME:-SHARED_REVIEW_OWNER_TOKEN}"
smtp_name="${REVIEW_SMTP_URL_NAME:-SHARED_REVIEW_SMTP_URL}"
from="${REVIEW_EMAIL_FROM:-}"
port="${REVIEW_PORT:-8080}"
image="${REVIEW_IMAGE:-wheelhouse-shared-review:${version}}"
remote_dir="${REVIEW_REMOTE_DIR:-shared-review}"

fail() {
	echo "ssh-deploy: $*" >&2
	exit 2
}

[ -n "$host" ] || fail "set REVIEW_SSH_HOST (user@host)."
[ -n "$url" ] || fail "set REVIEW_PUBLIC_URL (https://...)."
case "$url" in https://*) ;; *) fail "REVIEW_PUBLIC_URL must start with https:// so sign-ins are not sent in the clear." ;; esac
[[ "$token_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "REVIEW_OWNER_TOKEN_NAME is not a variable name."
[[ "$smtp_name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail "REVIEW_SMTP_URL_NAME is not a variable name."
[[ "$port" =~ ^[0-9]+$ ]] || fail "REVIEW_PORT is not a port."
[[ "$remote_dir" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "REVIEW_REMOTE_DIR may hold only letters, digits, . _ / and -."
[[ "$image" =~ ^[A-Za-z0-9._/:@-]+$ ]] || fail "REVIEW_IMAGE is not an image name."

token="${!token_name:-}"
smtp="${!smtp_name:-}"
if [ "$dry" = 0 ]; then
	[ -n "$token" ] || fail "$token_name is not set: run this under 'wh-vault run --only $token_name -- ...'."
	[ "${#token}" -ge 24 ] || fail "$token_name is shorter than 24 characters."
	if [ -n "$from" ] && [ -z "$smtp" ]; then fail "REVIEW_EMAIL_FROM is set but $smtp_name is not."; fi
fi

run() {
	if [ "$dry" = 1 ]; then
		printf '+ %s\n' "$*"
	else
		"$@"
	fi
}

echo "Deploying the shared review server $version to $host, for $url"
run docker build -f "$here/Dockerfile" -t "$image" "$plugin"
if [ "$dry" = 1 ]; then
	printf '+ docker save %s | ssh %s docker load\n' "$image" "$host"
else
	docker save "$image" | ssh "$host" docker load
fi

# The env file goes through SSH's standard input: no value is ever an argument.
if [ "$dry" = 1 ]; then
	printf '+ ssh %s (writes %s/review.env, mode 0600: REVIEW_PUBLIC_URL, REVIEW_OWNER_TOKEN%s, REVIEW_TRUST_PROXY)\n' \
		"$host" "$remote_dir" "$([ -n "$from" ] && printf ', REVIEW_EMAIL_FROM, REVIEW_SMTP_URL')"
else
	{
		printf 'REVIEW_PUBLIC_URL=%s\n' "$url"
		printf 'REVIEW_OWNER_TOKEN=%s\n' "$token"
		printf 'REVIEW_TRUST_PROXY=1\n'
		if [ -n "$from" ]; then
			printf 'REVIEW_EMAIL_FROM=%s\n' "$from"
			printf 'REVIEW_SMTP_URL=%s\n' "$smtp"
		fi
	} | ssh "$host" "umask 077 && mkdir -p '$remote_dir' && cat > '$remote_dir/review.env'"
fi

run ssh "$host" "docker rm -f shared-review >/dev/null 2>&1 || true; docker run -d --name shared-review --restart unless-stopped --env-file '$remote_dir/review.env' -v shared-review-data:/data -p 127.0.0.1:$port:8080 '$image'"

echo "The review server runs on $host at 127.0.0.1:$port."
echo "Put a TLS proxy in front of it for $url (see $here/Caddyfile.example), then set the plugin's review server address to $url."
