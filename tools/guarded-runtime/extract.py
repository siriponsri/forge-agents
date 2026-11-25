"""Windows engineering extraction; materialize internal source symlinks only.
No archive member may escape the destination. No devices, links outside tree.
"""
import pathlib, sys, tarfile, shutil, json
archive, dest = map(pathlib.Path, sys.argv[1:])
dest = dest.resolve()
links = []
unresolved = []
with tarfile.open(archive) as tar:
    members = tar.getmembers()
    prefix = pathlib.PurePosixPath(members[0].name).parts[0]
    for item in members:
        parts = pathlib.PurePosixPath(item.name).parts
        if parts[0] != prefix or '..' in parts or '\\' in item.name:
            raise ValueError('UNSAFE_ARCHIVE')
        target = dest.joinpath(*parts[1:])
        if item.isdir():
            target.mkdir(parents=True, exist_ok=True)
        elif item.isfile():
            target.parent.mkdir(parents=True, exist_ok=True)
            with tar.extractfile(item) as source, target.open('wb') as out:
                shutil.copyfileobj(source, out)
        elif item.issym():
            original = (target.parent / item.linkname).resolve()
            if not original.is_relative_to(dest):
                raise ValueError('EXTERNAL_LINK')
            links.append((target, original, item.linkname))
        else:
            raise ValueError('UNSUPPORTED_ARCHIVE_MEMBER')
    for target, original, name in links:
        target.parent.mkdir(parents=True, exist_ok=True)
        if original.is_file():
            shutil.copyfile(original, target)
        elif original.is_dir():
            shutil.copytree(original, target, dirs_exist_ok=True)
        else:
            # Upstream includes dangling editor links into ignored node_modules.
            # Preserve their target as metadata, never execute or invent content.
            unresolved.append({'path': str(target.relative_to(dest)), 'target': name})
print(json.dumps({'materializedLinks': len(links)-len(unresolved), 'unresolvedLinks': unresolved}))
