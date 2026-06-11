import fs from "node:fs";

export interface ExtensionMethod {
  name: string;
  description: string;
  params?: Record<string, any>;
}

export function loadExtensionConfig(configPath: string): ExtensionMethod[] {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Extension config file not found: ${configPath}`);
  }
  const content = fs.readFileSync(configPath, "utf-8");
  if (configPath.endsWith(".json")) {
    const parsed = JSON.parse(content);
    return parsed.methods || parsed;
  } else {
    return parseSimpleYaml(content);
  }
}

function parseSimpleYaml(content: string): ExtensionMethod[] {
  const lines = content.split(/\r?\n/);
  const methods: ExtensionMethod[] = [];
  let currentMethod: Partial<ExtensionMethod> | null = null;
  let inParams = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line === "methods:") {
      inParams = false;
      continue;
    }

    if (line.startsWith("-")) {
      if (currentMethod && currentMethod.name) {
        methods.push(currentMethod as ExtensionMethod);
      }
      currentMethod = {};
      inParams = false;
      
      const kv = line.slice(1).trim();
      if (kv) {
        parseKeyValue(kv, currentMethod);
      }
      continue;
    }

    if (currentMethod) {
      if (line.startsWith("params:")) {
        inParams = true;
        currentMethod.params = {};
        continue;
      }

      if (inParams && line.includes(":")) {
        const parts = line.split(":");
        const pKey = parts[0].trim();
        const pVal = parts.slice(1).join(":").trim();
        if (currentMethod.params) {
          currentMethod.params[pKey] = pVal.replace(/^['"]|['"]$/g, "");
        }
        continue;
      }

      if (line.includes(":")) {
        parseKeyValue(line, currentMethod);
      }
    }
  }

  if (currentMethod && currentMethod.name) {
    methods.push(currentMethod as ExtensionMethod);
  }

  return methods;
}

function parseKeyValue(line: string, target: any) {
  const parts = line.split(":");
  const key = parts[0].trim();
  const value = parts.slice(1).join(":").trim().replace(/^['"]|['"]$/g, "");
  if (key === "name") target.name = value;
  else if (key === "description") target.description = value;
}
