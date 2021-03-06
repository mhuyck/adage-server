#!/bin/bash

# Avoid silent and/or consumed failures within a bash script.
# if interested: http://redsymbol.net/articles/unofficial-bash-strict-mode/
set -euo pipefail
IFS=$'\n\t'

# REMOTE=example.ecr.us-west-2.amazonaws.com
NAME=greenescientist/adageserver
HASH=$(git rev-parse HEAD)

#eval $(aws ecr get-login)

# Push same image twice, once with the commit hash as the tag, and once with
# 'latest' as the tag. 'latest' will always refer to the last image that was
# built, since the next time this script is run, it'll get overridden. The
# commit hash, however, is a constant reference to this image.
#docker tag -f $NAME $REMOTE/$NAME:$HASH
#docker push $REMOTE/$NAME:$HASH
#docker tag -f $NAME $REMOTE/$NAME:latest
#docker push $REMOTE/$NAME:latest

#docker logout https://$REMOTE

docker login --username=$DOCKER_USER --password=$DOCKER_PASSWD \
  --email=$DOCKER_EMAIL
# Flag --email has been deprecated, will be removed in 1.13. CircleCI Still
# requires this.

# Don't need $REMOTE for docker hub but we'll want it later.
docker tag $NAME $NAME:$HASH
docker push $NAME:$HASH

# CircleCI Docker is old enough that -f is required here. It will break
# locally though. So only use in the CIRCLECI environment. One day we will
# have to remove this when CircleCI updates Docker.
if [ $CIRCLECI ]
then
  docker tag -f $NAME $NAME:latest
else
  docker tag $NAME $NAME:latest
fi
docker push $NAME:latest

docker logout
