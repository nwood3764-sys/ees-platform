"""Split a layouts SQL file into chunks <= 55KB at '-- Layout:' boundaries.

The translator emits a single DO $$ block. This splitter:
  - Extracts the soft-delete preamble + DO header into chunk 1
  - Splits remaining body by '-- Layout:' markers
  - Wraps each chunk in DO $$ ... END $$
  - Writes /tmp/<table>_layouts_chunk_N.sql

Note: only the FIRST chunk contains the soft-delete UPDATE (the others are
additive INSERT-only chunks).
"""
import os, re, sys

MAX = 55000

def split_one(table):
    path = f'/tmp/{table}_layouts.sql'
    if not os.path.exists(path):
        return []
    src = open(path).read()
    # Find soft-delete UPDATE (the part before the first '-- Layout:')
    pre_marker = '-- Layout:'
    idx = src.find(pre_marker)
    if idx < 0:
        # Single chunk, no layouts
        with open(f'/tmp/{table}_layouts_chunk_1.sql', 'w') as f:
            f.write(src)
        return [f'/tmp/{table}_layouts_chunk_1.sql']
    preamble = src[:idx]  # includes DO/DECLARE/BEGIN + soft-delete update
    body = src[idx:]
    # Find END $$;
    body_end = body.rfind('END $$;')
    suffix = body[body_end:] if body_end >= 0 else 'END $$;'
    body = body[:body_end] if body_end >= 0 else body

    # Split body by '-- Layout:' markers
    parts = re.split(r'(-- Layout:)', body)
    chunks_layouts = []
    i = 0
    while i < len(parts):
        if parts[i] == '-- Layout:':
            chunks_layouts.append('-- Layout:' + parts[i+1])
            i += 2
        else:
            i += 1

    # Build the DO header (without soft-delete) for chunks 2+
    do_header = """DO $$
DECLARE
  fb uuid := 'c5a01ec8-960f-42ab-8a9e-a49822de89af'::uuid;
  layout_id uuid;
  sec_id uuid;
  rt_id uuid;
BEGIN
"""
    end_block = '\nEND $$;\n'

    chunks = []
    cur_size = len(preamble)
    cur = [preamble]
    chunk_idx = 1
    paths_out = []

    def flush(extra_body=''):
        nonlocal chunks, cur, cur_size, chunk_idx, paths_out
        # If first chunk, the preamble already has DO header, so finish with END $$
        # If subsequent, we need full DO wrap
        sql_text = ''.join(cur) + extra_body + end_block
        path_out = f'/tmp/{table}_layouts_chunk_{chunk_idx}.sql'
        with open(path_out, 'w') as f:
            f.write(sql_text)
        paths_out.append(path_out)
        chunk_idx += 1
        cur = [do_header]
        cur_size = len(do_header)

    for c in chunks_layouts:
        if cur_size + len(c) > MAX:
            flush()
        cur.append(c)
        cur_size += len(c)
    if cur_size > 0 and (cur != [do_header]):
        flush()

    return paths_out

if __name__ == '__main__':
    tables = sys.argv[1:]
    if not tables:
        # Default: all
        from orchestrate import TARGETS
        tables = [t for t, _ in TARGETS]
    for tbl in tables:
        paths = split_one(tbl)
        sizes = [os.path.getsize(p) for p in paths]
        print(f"  {tbl}: {len(paths)} chunks, sizes: {sizes}")
