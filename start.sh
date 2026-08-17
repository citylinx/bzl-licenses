#!/bin/bash

script_path="$(cd "$(dirname "$0")" && pwd)"

if [ "$GITURL" != "" ]; then
    echo -e "[url \"${GITURL%/}\"]\r\n    insteadOf = ssh://git@github.com/beezeelinx\r\n[url \"${GITURL%/}\"]\r\n    insteadOf = https://github.com/beezeelinx\n" > /home/beezeelinx/.gitconfig;
fi

# echo "${@}"
# cat /home/beezeelinx/.gitconfig

node "$script_path/licenses.js" "${@}"
error=$?

if [ "$GITURL" != "" ]; then
    rm -f /home/beezeelinx/.gitconfig
fi

exit $error