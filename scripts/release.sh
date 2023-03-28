#!/bin/bash
# This script will run towncrier to and generate a release commit, tag and push to the origin.

if ! command -v jq &> /dev/null
then
    echo "You must install jq to use this script"
    exit
fi

VERSION=`jq -r .version package.json`
TAG="$VERSION"
HEAD_BRANCH=`git remote show origin | sed -n '/HEAD branch/s/.*: //p'`
REPO_NAME=`git remote show origin -n | grep -m 1 -oP '(?<=git@github.com:)(.*)(?=.git)'`

if [[ "`git branch --show-current`" != $HEAD_BRANCH ]]; then
    echo "You must be on the develop branch to run this command."
    exit 1
fi

if [ $(git tag -l "$TAG") ]; then
    echo "Tag $TAG already exists, not continuing."
    exit 1
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