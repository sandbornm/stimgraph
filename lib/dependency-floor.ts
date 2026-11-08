type Version = readonly [number, number, number];

const NEXT_FLOOR: Version = [16, 4, 5];
const BRACE_EXPANSION_1_FLOOR: Version = [1, 1, 21];
const ESBUILD_CEILING: Version = [0, 24, 2];

const REACT_SERVER_DOM_FLOORS: readonly Version[] = [
  [19, 0, 9],
  [19, 1, 10],
  [19, 2, 9],
  [19, 3, 1],
];

const REACT_SERVER_DOM_PACKAGES = [
  'react-server-dom-webpack',
  'react-server-dom-parcel',
  'react-server-dom-turbopack',
] as const;

export type DirectPins = {
  next: string;
  eslintConfigNext: string;
  react: string;
  reactDom: string;
  reactServerDomWebpack: string;
};

export function pinsFromPackageJson(manifest: {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}): DirectPins {
  const dependencies = manifest.dependencies ?? {};
  const devDependencies = manifest.devDependencies ?? {};
  return {
    next: dependencies.next ?? '',
    eslintConfigNext: devDependencies['eslint-config-next'] ?? '',
    react: dependencies.react ?? '',
    reactDom: dependencies['react-dom'] ?? '',
    reactServerDomWebpack: devDependencies['react-server-dom-webpack'] ?? dependencies['react-server-dom-webpack'] ?? '',
  };
}

function parseVersion(value: string): Version | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersion(left: Version, right: Version) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

function reactServerDomPatched(version: Version) {
  const floor = REACT_SERVER_DOM_FLOORS.find((item) => item[0] === version[0] && item[1] === version[1]);
  if (floor) return compareVersion(version, floor) >= 0;
  const newest = REACT_SERVER_DOM_FLOORS[REACT_SERVER_DOM_FLOORS.length - 1];
  return version[0] > newest[0] || (version[0] === newest[0] && version[1] > newest[1]);
}

function belowNextFloor(label: string, value: string) {
  const version = parseVersion(value);
  if (version && compareVersion(version, NEXT_FLOOR) >= 0) return null;
  return `${label} is below 16.4.5`;
}

function packageVersions(lockfile: string, name: string) {
  const versions = new Set<string>();
  const pattern = new RegExp(`^  ${name}@(\\d+\\.\\d+\\.\\d+)`, 'gm');
  for (const match of lockfile.matchAll(pattern)) versions.add(match[1]);
  return [...versions].sort();
}

export function dependencyViolations(pins: DirectPins) {
  const violations = [
    belowNextFloor(`next ${pins.next || 'missing'}`, pins.next),
    belowNextFloor(`eslint-config-next ${pins.eslintConfigNext || 'missing'}`, pins.eslintConfigNext),
  ].filter((item): item is string => item !== null);
  if (pins.react !== pins.reactDom || pins.react !== pins.reactServerDomWebpack) {
    violations.push(`react ${pins.react}, react-dom ${pins.reactDom}, and react-server-dom-webpack ${pins.reactServerDomWebpack} do not match`);
  }
  const serverDom = parseVersion(pins.reactServerDomWebpack);
  if (!serverDom || !reactServerDomPatched(serverDom)) {
    violations.push(`react-server-dom-webpack ${pins.reactServerDomWebpack || 'missing'} is not in the patched set`);
  }
  return violations;
}

export function lockfileViolations(lockfile: string) {
  const violations: string[] = [];
  for (const name of ['next', 'eslint-config-next'] as const) {
    const versions = packageVersions(lockfile, name);
    if (versions.length === 0) violations.push(`lockfile has no ${name}`);
    for (const version of versions) {
      const violation = belowNextFloor(`lockfile ${name}@${version}`, version);
      if (violation) violations.push(violation);
    }
  }
  const react = packageVersions(lockfile, 'react');
  const reactDom = packageVersions(lockfile, 'react-dom');
  const serverDom = packageVersions(lockfile, 'react-server-dom-webpack');
  if (react.length !== 1 || reactDom.length !== 1 || serverDom.length !== 1 || react[0] !== reactDom[0] || react[0] !== serverDom[0]) {
    violations.push(`lockfile react ${react.join(', ') || 'missing'}, react-dom ${reactDom.join(', ') || 'missing'}, and react-server-dom-webpack ${serverDom.join(', ') || 'missing'} do not match`);
  }
  for (const name of REACT_SERVER_DOM_PACKAGES) {
    for (const version of packageVersions(lockfile, name)) {
      const parsed = parseVersion(version);
      if (!parsed || !reactServerDomPatched(parsed)) violations.push(`lockfile ${name}@${version} is not in the patched set`);
    }
  }
  for (const version of packageVersions(lockfile, 'brace-expansion')) {
    const parsed = parseVersion(version);
    if (!parsed || parsed[0] !== 1 || compareVersion(parsed, BRACE_EXPANSION_1_FLOOR) >= 0) continue;
    violations.push(`lockfile brace-expansion@${version} is below 1.1.21`);
  }
  for (const version of packageVersions(lockfile, 'esbuild')) {
    const parsed = parseVersion(version);
    if (!parsed || compareVersion(parsed, ESBUILD_CEILING) <= 0) {
      violations.push(`lockfile esbuild@${version} is at or below 0.24.2`);
    }
  }
  return violations;
}
