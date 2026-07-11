const minimum = [20, 19, 0];

export function supportsNode(version) {
  const current = String(version).replace(/^v/, '').split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < minimum.length; index += 1) {
    if ((current[index] ?? 0) > minimum[index]) return true;
    if ((current[index] ?? 0) < minimum[index]) return false;
  }
  return true;
}

if (import.meta.url === `file://${process.argv[1]}` && !supportsNode(process.version)) {
  console.error(`super helper requires Node >=20.19.0; current runtime is ${process.version}.`);
  process.exitCode = 1;
}
