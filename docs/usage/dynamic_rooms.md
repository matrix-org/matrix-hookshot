Dynamic Rooms
=============

<section class="notice">
Anyone who has access to your homeserver can query these aliases (even over federation), and aliases
 do not support checking if a user is authorised to view the content before creation. If you are bridging non-public
 content, it is advisable to disable this feature.
</section>


Some bridges support dynamically creating rooms that point to resources based on an alias given by a user.

Presently, the following are supported:

- `#github_$owner:example.com` - For a Matrix space containing a user's discussions and repositories
- `#github_$owner_$repo:example.com` - For GitHub repositories
- `#github_$owner_$repo_$issuenumber:example.com` - For GitHub issues
- `#github_disc_$owner_$repo:example.com` - For GitHub discussions for a repository

Where $word is replaced by the appropriate value.

(Some of these may not be supported, depending on bridge configuration and registration file changes)

## Disabling support

This feature can be disabled simply by removing alias fields from the registration file.
