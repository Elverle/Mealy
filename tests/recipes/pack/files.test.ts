// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { z } from 'zod';
import { readJsonFile, writeJsonFile } from '@/lib/recipes/pack/files';
import { PackError } from '@/lib/recipes/pack/errors';

const ItemsSchema = z.object({ items: z.array(z.object({ name: z.string().min(2) })) });

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mealy-pack-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('readJsonFile', () => {
  it('returns the onMissing value when the file does not exist', async () => {
    const value = await readJsonFile(path.join(dir, 'absent.json'), ItemsSchema, () => ({
      items: [],
    }));
    expect(value).toEqual({ items: [] });
  });

  it('propagates the error thrown by onMissing', async () => {
    const missingPath = path.join(dir, 'absent.json');
    await expect(
      readJsonFile(missingPath, ItemsSchema, () => {
        throw new PackError(`Manca ${missingPath}: lancia prima "pnpm recipes:pack select".`);
      })
    ).rejects.toThrow(`Manca ${missingPath}: lancia prima "pnpm recipes:pack select".`);
  });

  it('throws a PackError naming the file when the JSON is broken', async () => {
    const filePath = path.join(dir, 'broken.json');
    fs.writeFileSync(filePath, '{ "items": [', 'utf8');
    const error = await readJsonFile(filePath, ItemsSchema, () => ({ items: [] })).catch(
      (err: unknown) => err
    );
    expect(error).toBeInstanceOf(PackError);
    expect((error as Error).message.startsWith(`File non valido: ${filePath}: `)).toBe(true);
  });

  it('throws a PackError with the first schema issue as path: message', async () => {
    const filePath = path.join(dir, 'invalid.json');
    fs.writeFileSync(filePath, JSON.stringify({ items: [{ name: 'a' }] }), 'utf8');
    await expect(readJsonFile(filePath, ItemsSchema, () => ({ items: [] }))).rejects.toThrow(
      new PackError(
        `File non valido: ${filePath}: items.0.name: String must contain at least 2 character(s)`
      )
    );
  });

  it('uses (radice) when the schema issue is at the root', async () => {
    const filePath = path.join(dir, 'root.json');
    fs.writeFileSync(filePath, '[]', 'utf8');
    await expect(readJsonFile(filePath, ItemsSchema, () => ({ items: [] }))).rejects.toThrow(
      `File non valido: ${filePath}: (radice): `
    );
  });

  it('parses a valid file through the schema', async () => {
    const filePath = path.join(dir, 'valid.json');
    fs.writeFileSync(filePath, JSON.stringify({ items: [{ name: 'riso' }] }), 'utf8');
    const value = await readJsonFile(filePath, ItemsSchema, () => ({ items: [] }));
    expect(value).toEqual({ items: [{ name: 'riso' }] });
  });
});

describe('writeJsonFile', () => {
  it('creates missing parent directories and writes indented JSON ending with a newline', async () => {
    const filePath = path.join(dir, 'nested', 'deeper', 'data.json');
    await writeJsonFile(filePath, { items: [{ name: 'riso' }] });

    const text = fs.readFileSync(filePath, 'utf8');
    expect(text).toBe('{\n  "items": [\n    {\n      "name": "riso"\n    }\n  ]\n}\n');
  });

  it('leaves no temporary file next to the written one', async () => {
    const filePath = path.join(dir, 'data.json');
    await writeJsonFile(filePath, { items: [{ name: 'riso' }] });

    expect(fs.readdirSync(dir)).toEqual(['data.json']);
  });

  it('replaces an existing file with the new content', async () => {
    const filePath = path.join(dir, 'data.json');
    fs.writeFileSync(filePath, '{"items": [{"name": "vecchio"}, {"name": "più lungo"}]}\n', 'utf8');

    await writeJsonFile(filePath, { items: [{ name: 'nuovo' }] });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('{\n  "items": [\n    {\n      "name": "nuovo"\n    }\n  ]\n}\n');
    expect(fs.readdirSync(dir)).toEqual(['data.json']);
  });

  it('round-trips through readJsonFile', async () => {
    const filePath = path.join(dir, 'round', 'trip.json');
    const value = { items: [{ name: 'pane' }, { name: 'olio' }] };
    await writeJsonFile(filePath, value);
    await expect(readJsonFile(filePath, ItemsSchema, () => ({ items: [] }))).resolves.toEqual(value);
  });
});
