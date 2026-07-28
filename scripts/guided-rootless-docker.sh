#!/usr/bin/env bash
set -euo pipefail

readonly EX_UNAVAILABLE=69
readonly instance_name=rak-docker
readonly context_name=rak-rootless

confirm() {
  local answer
  read -r -p "$1 [y/N]: " answer
  [[ "$answer" == y || "$answer" == Y || "$answer" == yes || "$answer" == YES ]]
}

if [[ ! -t 0 ]]; then
  printf '%s\n' "Guided Docker setup requires an interactive terminal." >&2
  exit "$EX_UNAVAILABLE"
fi
if [[ $(uname -s) != Darwin ]]; then
  printf '%s\n' \
    "Automatic rootless Docker setup is currently available only on macOS." \
    "Ask the technical operator to configure a rootless Docker context on this computer." >&2
  exit "$EX_UNAVAILABLE"
fi
if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' \
    "The Docker command is not installed." \
    "Install Docker Desktop for the command-line tools, then run ./start.sh again." >&2
  exit "$EX_UNAVAILABLE"
fi

printf '%s\n' \
  "" \
  "Guided setup: safer Docker environment" \
  "This creates a separate Linux virtual machine named '${instance_name}'." \
  "Docker will run without root privileges inside that machine." \
  "Your existing Docker Desktop data will not be deleted."

if ! command -v limactl >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    printf '%s\n' \
      "" \
      "Homebrew is required to install Lima automatically." \
      "Ask the technical operator to install Homebrew and Lima, then run ./start.sh again." >&2
    exit "$EX_UNAVAILABLE"
  fi
  if ! confirm "Install Lima with Homebrew now?"; then
    printf '%s\n' "No changes were made."
    exit "$EX_UNAVAILABLE"
  fi
  brew install lima
fi

instance_exists=false
if [[ $(limactl list "$instance_name" --format '{{.Name}}' 2>/dev/null || true) == "$instance_name" ]]; then
  instance_exists=true
fi

if [[ "$instance_exists" == false ]]; then
  printf '%s\n' \
    "" \
    "Lima must download a Linux image and create the '${instance_name}' virtual machine." \
    "This can take several minutes and uses additional disk space."
  if ! confirm "Create the rootless Docker virtual machine now?"; then
    printf '%s\n' "The virtual machine was not created."
    exit "$EX_UNAVAILABLE"
  fi
  limactl start --name="$instance_name" --tty=false template:docker
else
  instance_status=$(limactl list "$instance_name" --format '{{.Status}}')
  if [[ "$instance_status" != Running ]]; then
    if ! confirm "Start the existing '${instance_name}' virtual machine now?"; then
      printf '%s\n' "The virtual machine was not started."
      exit "$EX_UNAVAILABLE"
    fi
    limactl start "$instance_name"
  fi
fi

instance_directory=$(limactl list "$instance_name" --format '{{.Dir}}')
if [[ -z "$instance_directory" || "$instance_directory" != /* || -L "$instance_directory" ]]; then
  printf '%s\n' "Lima returned an unsafe virtual-machine directory." >&2
  exit "$EX_UNAVAILABLE"
fi
socket_path="$instance_directory/sock/docker.sock"
if [[ ! -S "$socket_path" ]]; then
  printf '%s\n' "The rootless Docker socket is not ready. Ask the technical operator for help." >&2
  exit "$EX_UNAVAILABLE"
fi
docker_endpoint="unix://$socket_path"

if docker context inspect "$context_name" >/dev/null 2>&1; then
  existing_endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}' "$context_name")
  if [[ "$existing_endpoint" != "$docker_endpoint" ]]; then
    printf '%s\n' \
      "A Docker context named '${context_name}' already points somewhere else." \
      "No context was changed. Ask the technical operator to review it." >&2
    exit "$EX_UNAVAILABLE"
  fi
else
  if ! confirm "Add the '${context_name}' Docker connection now?"; then
    printf '%s\n' "The Docker connection was not added."
    exit "$EX_UNAVAILABLE"
  fi
  docker context create "$context_name" --docker "host=$docker_endpoint" \
    --description "Repo Assessment Kit rootless Docker"
fi

docker context use "$context_name" >/dev/null
security_options=$(docker info --format '{{json .SecurityOptions}}')
if [[ "$security_options" != *name=rootless* ]]; then
  printf '%s\n' \
    "The new Docker connection did not confirm rootless mode." \
    "No assessment will run. Ask the technical operator to inspect the Lima instance." >&2
  exit "$EX_UNAVAILABLE"
fi

printf '%s\n' \
  "" \
  "Rootless Docker is ready." \
  "The readiness check will run again and show the next item, if any."
