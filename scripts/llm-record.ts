// Usage: pnpm llm:record --name gemini-cena-vegano --count 3 --meal cena --diet vegano --appliance friggitrice-ad-aria

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateText, Output, NoObjectGeneratedError } from 'ai';
import {
  GenerateRecipesOutputSchema,
  RecipeConstraintsSchema,
  DEFAULT_HOUSEHOLD,
  type RecipeConstraints,
} from '@/lib/domain/types';
import { getModel, readLlmConfig, getLlmTimeoutMs } from '@/lib/llm/model';
import {
  buildRecipeInstructions,
  buildRecipePrompt,
  MAX_EXCLUDED_TITLES,
} from '@/lib/llm/prompts';

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* file assente */
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      name: { type: 'string' },
      count: { type: 'string', default: '3' },
      meal: { type: 'string' },
      persons: { type: 'string', default: '2' },
      diet: { type: 'string', multiple: true },
      appliance: { type: 'string', multiple: true },
      style: { type: 'string', multiple: true },
      exclude: { type: 'string', multiple: true },
    },
    strict: true,
  });

  const name = values.name?.trim();
  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    console.error('Errore: l\'opzione --name è obbligatoria e deve contenere solo caratteri [a-z0-9-].');
    process.exitCode = 1;
    return;
  }

  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    console.error('Errore: l\'opzione --count deve essere un intero tra 1 e 10.');
    process.exitCode = 1;
    return;
  }

  const persons = Number(values.persons);
  if (!Number.isInteger(persons) || persons < 1 || persons > 12) {
    console.error('Errore: l\'opzione --persons deve essere un intero tra 1 e 12.');
    process.exitCode = 1;
    return;
  }

  const meal = values.meal?.trim();
  if (meal && meal !== 'pranzo' && meal !== 'cena') {
    console.error('Errore: l\'opzione --meal può essere solo "pranzo" o "cena".');
    process.exitCode = 1;
    return;
  }

  const appliances =
    values.appliance && values.appliance.length > 0
      ? values.appliance
      : [...DEFAULT_HOUSEHOLD.appliances];

  const rawConstraints = {
    persons,
    meal_type: meal ? meal : null,
    diet_tags: values.diet ?? [],
    meal_style_tags: values.style ?? [],
    appliances,
    ingredient_likes: [],
    ingredient_dislikes: [],
  };

  const parsedConstraintsResult = RecipeConstraintsSchema.safeParse(rawConstraints);
  if (!parsedConstraintsResult.success) {
    console.error('Errore di validazione dei vincoli:', parsedConstraintsResult.error.message);
    process.exitCode = 1;
    return;
  }
  const constraints: RecipeConstraints = parsedConstraintsResult.data;

  const rawExcludes = values.exclude ?? [];
  const cleanedTitles: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawExcludes) {
    const t = raw.trim();
    if (t.length > 0 && !seen.has(t)) {
      seen.add(t);
      cleanedTitles.push(t);
    }
  }
  const excludeTitles = cleanedTitles.slice(0, MAX_EXCLUDED_TITLES);

  const config = readLlmConfig();
  const model = getModel();
  const instructions = buildRecipeInstructions();
  const prompt = buildRecipePrompt(constraints, count, excludeTitles);
  const timeoutMs = getLlmTimeoutMs();

  const outDir = path.resolve(process.cwd(), 'tests/fixtures/llm/recorded');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Esecuzione chiamata LLM con provider="${config.provider}", model="${config.model}"...`);

  try {
    const result = await generateText({
      model,
      instructions,
      prompt,
      output: Output.object({ schema: GenerateRecipesOutputSchema }),
      temperature: 0.8,
      maxRetries: 1,
      timeout: timeoutMs,
    });

    const targetPath = path.join(outDir, `${name}.txt`);
    fs.writeFileSync(targetPath, result.text, 'utf-8');
    console.log(`Risposta registrata con successo in ${targetPath}`);
  } catch (err) {
    if (NoObjectGeneratedError.isInstance(err)) {
      const invalidPath = path.join(outDir, `${name}.invalid.txt`);
      fs.writeFileSync(invalidPath, err.text ?? '', 'utf-8');
      console.error(`Il modello ha prodotto un output non conforme allo schema. Salvato in ${invalidPath}`);
      console.error(err.message);
    } else {
      console.error('Errore durante la chiamata LLM:', err);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
