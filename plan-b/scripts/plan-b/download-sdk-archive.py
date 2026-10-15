#!/usr/bin/env python3
"""Fetch an official SDK archive in resumable ranges and verify its repository checksum."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('url')
    parser.add_argument('size', type=int)
    parser.add_argument('sha1')
    parser.add_argument('destination', type=Path)
    parser.add_argument('--jobs', type=int, default=6)
    args = parser.parse_args()
    if args.jobs < 1 or args.size < 1:
        parser.error('jobs and size must be positive')
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    if args.destination.is_file() and args.destination.stat().st_size == args.size:
        with args.destination.open('rb') as existing:
            checksum = hashlib.file_digest(existing, 'sha1').hexdigest()
        if checksum == args.sha1:
            print(f'Cached official archive verified: {args.destination}', flush=True)
            return
    parts = args.destination.with_name(args.destination.name + '.parts')
    parts.mkdir(exist_ok=True)
    chunk_size = 16 * 1024 * 1024
    count = (args.size + chunk_size - 1) // chunk_size

    def fetch(index):
        first = index * chunk_size
        last = min(args.size, first + chunk_size) - 1
        part = parts / str(index)
        if not part.is_file() or part.stat().st_size != last - first + 1:
            subprocess.run([
                'curl', '--fail', '--silent', '--show-error', '--location',
                '--retry', '3', '--retry-all-errors', '--retry-delay', '2', '--connect-timeout', '20',
                '--max-time', '600', '--range', f'{first}-{last}',
                '--output', str(part), args.url,
            ], check=True)
        if part.stat().st_size != last - first + 1:
            raise RuntimeError(f'Invalid range length for part {index}')
        return index

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = [pool.submit(fetch, i) for i in range(count)]
        for completed, future in enumerate(as_completed(futures), 1):
            future.result()
            print(f'{args.destination.name}: {completed}/{count} ranges downloaded', flush=True)
    checksum = hashlib.sha1()
    with args.destination.open('wb') as target:
        for index in range(count):
            with (parts / str(index)).open('rb') as source:
                while block := source.read(1024 * 1024):
                    target.write(block)
                    checksum.update(block)
    if checksum.hexdigest() != args.sha1 or args.destination.stat().st_size != args.size:
        raise RuntimeError('Official SDK repository checksum did not match')
    for index in range(count):
        (parts / str(index)).unlink()
    parts.rmdir()
    print(f'Checksum verified: {args.destination}', flush=True)


if __name__ == '__main__':
    main()
