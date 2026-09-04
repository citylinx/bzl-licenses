#!/usr/bin/env bash

# Inspired by nvm install script (https://github.com/nvm-sh/nvm/blob/master/install.sh)

{ # this ensures the entire script is downloaded #

    bzl_has() {
        type "$1" >/dev/null 2>&1
    }

    # shellcheck disable=SC2120
    bzl_source() {
        local BZL_GITHUB_REPO
        BZL_GITHUB_REPO="${BZL_INSTALL_GITHUB_REPO:-beezeelinx/bzl-licenses}"
        local BZL_SOURCE_URL
        BZL_SOURCE_URL="$BZL_SOURCE"
        if [ -z "$BZL_SOURCE_URL" ]; then
            BZL_SOURCE_URL="https://github.com/${BZL_GITHUB_REPO}.git"
        fi
        echo "$BZL_SOURCE_URL"
    }

    bzl_ref() {
        local BZL_GIT_REF
        BZL_GIT_REF="$BZL_REF"
        if [ -z "$BZL_GIT_REF" ]; then
            # Default branch of the remote, as before
            BZL_GIT_REF="HEAD"
        fi
        echo "$BZL_GIT_REF"
    }

    bzl_default_install_dir() {
        local TEMP_DIR
        TEMP_DIR=$(dirname "$(mktemp -u)")
        printf %s "${TEMP_DIR}/bzl-licenses-checker"
    }

    bzl_install_dir() {
        if [ -n "$BZL_LICENSES_CHECKER_DIR" ]; then
            printf %s "${BZL_LICENSES_CHECKER_DIR}"
        else
            bzl_default_install_dir
        fi
    }

    bzl_get_git_repo() {
        local INSTALL_DIR
        INSTALL_DIR="$(bzl_install_dir)"

        local fetch_error
        if [ -d "$INSTALL_DIR/.git" ]; then
            # Updating repo
            echo "=> bzl-licenses is already installed in $INSTALL_DIR, trying to update using git"
            command printf '\r=> '
            fetch_error="Failed to update bzl-licenses with latest version, run 'git fetch' in $INSTALL_DIR yourself."

            # The remote of an existing install dir was set when it was created: refresh it so that
            # a change of BZL_SOURCE is taken into account without having to remove the directory
            command git --git-dir="${INSTALL_DIR}/.git" remote set-url origin "$(bzl_source)" || {
                echo >&2 'Failed to set the URL of the remote "origin". Please report this!'
                exit 2
            }
        else
            fetch_error="Failed to fetch origin with latest version. Please report this!"
            echo "=> Downloading bzl-licenses from git to '$INSTALL_DIR'"
            command printf '\r=> '
            mkdir -p "${INSTALL_DIR}"
            if [ "$(ls -A "${INSTALL_DIR}")" ]; then
                # Initializing repo
                command git init "${INSTALL_DIR}" || {
                    echo >&2 'Failed to initialize bzl-licenses repo. Please report this!'
                    exit 2
                }
                command git --git-dir="${INSTALL_DIR}/.git" remote add origin "$(bzl_source)" 2>/dev/null ||
                    command git --git-dir="${INSTALL_DIR}/.git" remote set-url origin "$(bzl_source)" || {
                    echo >&2 'Failed to add remote "origin" (or set the URL). Please report this!'
                    exit 2
                }
            else
                # Cloning repo
                command git clone "$(bzl_source)" --depth=1 "${INSTALL_DIR}" || {
                    echo >&2 'Failed to clone bzl-licenses repo. Please report this!'
                    exit 2
                }
            fi
        fi

        if ! command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" fetch origin --depth=1 "$(bzl_ref)"; then
            echo >&2 "$fetch_error"
            exit 1
        fi

        command git -c advice.detachedHead=false --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" checkout -f --quiet FETCH_HEAD || {
            echo >&2 "Failed to checkout the latest version. Please report this!"
            exit 2
        }

        if [ -n "$(command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" show-ref refs/heads/master)" ]; then
            if command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" branch --quiet >/dev/null 2>&1; then
                command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" branch --quiet -D master >/dev/null 2>&1
            else
                echo >&2 "Your version of git is out of date. Please update it!"
                command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" branch -D master >/dev/null 2>&1
            fi
        fi

        echo "=> Compressing and cleaning up git repository"
        if ! command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" reflog expire --expire=now --all; then
            echo >&2 "Your version of git is out of date. Please update it!"
        fi
        if ! command git --git-dir="$INSTALL_DIR"/.git --work-tree="$INSTALL_DIR" gc --auto --aggressive --prune=now; then
            echo >&2 "Your version of git is out of date. Please update it!"
        fi
        return
    }

    bzl_run_docker() {
        local INSTALL_DIR
        local REPO_PATH
        local LICENSE_ARGS
        local GITURL
        local error

        while [ $# -gt 0 ]; do
            case $1 in
                --cmd)
                    shift
                    LICENSE_ARGS=$1
                    ;;
                --repo)
                    shift
                    REPO_PATH=$1
                    ;;
                --giturl)
                    shift
                    GITURL=$1
                    ;;
                *)
                    shift
                    ;;
            esac
        done

        if [ -z "$REPO_PATH" ] || [ ! -d "$REPO_PATH" ]; then
            echo >&2 "Missing repository path argument or invalid repositry directory (--repo)"
            exit 1
        fi

        if [ "$LICENSE_ARGS" == "" ]; then
            echo >&2 "Missing license checker command (--cmd)"
            exit 1
        fi

        INSTALL_DIR="$(bzl_install_dir)"

        if ! bzl_has git; then
            echo >&2 "You need to have git installed to run the license checker"
            exit 1
        fi

        bzl_get_git_repo

        echo

        (
            cd "$INSTALL_DIR"
            ./build_docker.sh
        ) || exit 1

        local DOCKER_ARGS

        DOCKER_ARGS="--rm -v $REPO_PATH:/opt/testing-module:ro"

        if [ "$GITURL" != "" ]; then
            DOCKER_ARGS="$DOCKER_ARGS -e GITURL=$GITURL"
        fi

        echo
        echo "Checking licenses of $REPO_PATH"
        echo

        # shellcheck disable=SC2086
        docker run $DOCKER_ARGS bzl-licenses-checker $LICENSE_ARGS /opt/testing-module
        error=$?

        bzl_reset

        if [ "$error" != "0" ]; then
            exit $error
        fi
    }

    bzl_reset() {
        unset -f bzl_reset bzl_run_docker bzl_has bzl_get_git_repo bzl_install_dir bzl_default_install_dir bzl_source bzl_ref
    }

    [ "_$BZL_ENV" = "_testing" ] || bzl_run_docker "${@}"

} # this ensures the entire script is downloaded #
