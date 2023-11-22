#!/bin/bash
# This script will run towncrier to and generate a release commit, tag and push to the origin.

if ! command -v jq &> /dev/null
then
    echo "You must install jq to use this script" >&2
    exit 1
fi

VERSION=`jq -r .version <(git show :package.json)`

function parseCargoVersion {
    awk '$1 == "version" {gsub("\"", "", $3); print $3}' $1
}
CARGO_TOML_VERSION=`parseCargoVersion <(git show :Cargo.toml)`
if [[ $VERSION != $CARGO_TOML_VERSION ]]; then
    echo "Node & Rust package versions do not match." >&2
    echo "Node version (package.json): ${VERSION}" >&2
    echo "Rust version (Cargo.toml): ${CARGO_TOML_VERSION}" >&2
    exit 2
fi
CARGO_LOCK_VERSION=`parseCargoVersion <(grep -A1 matrix-hookshot <(git show :Cargo.lock))`
if [[ $CARGO_TOML_VERSION != $CARGO_LOCK_VERSION ]]; then
    echo "Rust package version does not match the lockfile." >&2
    echo "Rust version (Cargo.toml): ${CARGO_TOML_VERSION}" >&2
    echo "Lockfile version (Cargo.lock): ${CARGO_LOCK_VERSION}" >&2
    exit 3
fi
TAG="$VERSION"
HEAD_BRANCH=`git remote show origin | sed -n '/HEAD branch/s/.*: //p'`
REPO_NAME=`git remote show origin -n | grep -m 1 -oP '(?<=git@github.com:)(.*)(?=.git)'`

if [[ "`git branch --show-current`" != $HEAD_BRANCH ]]; then
    echo "You must be on the $HEAD_BRANCH branch to run this command." >&2
    exit 4
fi

if [ $(git tag -l "$TAG") ]; then
    echo "Tag $TAG already exists, not continuing." >&2
    exit 5
fi

echo "Drafting a new release"
towncrier build --draft --version $VERSION> draft-release.txt
cat draft-release.txt

read -p "Happy with the changelog? <y/N> " prompt
if [[ $prompt != "y" && $prompt != "Y" && $prompt != "yes" && $prompt != "Yes" ]]
then
  rm draft-release.txt
  exit 0
fi

echo "Committing version"
towncrier build --version $VERSION
git commit CHANGELOG.md changelog.d/ package.json -m $TAG

echo "Proceeding to generate tags"
git tag -F draft-release.txt -s $TAG
rm draft-release.txt
echo "Generated tag $TAG"

echo "Pushing to origin"
git push origin $TAG
git push

echo "The CI to generate a release is now running. Check https://github.com/$REPO_NAME/releases and publish the release when it's ready."