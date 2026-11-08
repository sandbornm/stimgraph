type Version = readonly [number, number, number];

const NEXT_FLOOR: Version = [16, 4, 1];

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

const LOCK_PACKAGE = /^  (next|eslint-config-next|react-server-dom-webpack|react-server-dom-parcel|react-server-dom-turbopack)@(\d+\.\d+\.\d+)/gm;

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
  return `${label} is below 16.4.1`;
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
  const found = new Map<string, Set<string>>();
  for (const match of lockfile.matchAll(LOCK_PACKAGE)) {
    const versions = found.get(match[1]) ?? new Set<string>();
    versions.add(match[2]);
    found.set(match[1], versions);
  }
  const violations: string[] = [];
  for (const name of ['next', 'eslint-config-next'] as const) {
    const versions = [...(found.get(name) ?? [])];
    if (versions.length === 0) violations.push(`lockfile has no ${name}`);
    for (const version of versions) {
      const violation = belowNextFloor(`lockfile ${name}@${version}`, version);
      if (violation) violations.push(violation);
    }
  }
  if (!(found.get('react-server-dom-webpack')?.size)) violations.push('lockfile has no react-server-dom-webpack');
  for (const name of REACT_SERVER_DOM_PACKAGES) {
    for (const version of found.get(name) ?? []) {
      const parsed = parseVersion(version);
      if (!parsed || !reactServerDomPatched(parsed)) violations.push(`lockfile ${name}@${version} is not in the patched set`);
    }
  }
  return violations;
}
