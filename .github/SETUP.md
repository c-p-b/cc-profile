# GitHub Actions CI/CD Setup

This document outlines the GitHub Actions workflows and required setup for the cc-profile project.

## Workflows Overview

### 1. PR Validation (`.github/workflows/pr-validation.yml`)

**Triggers**: Pull requests to `main` branch
**Purpose**: Fast validation of code changes

**Features**:

- ⚡ Ultra-fast caching (Node.js deps, TypeScript builds, frontend assets)
- 🧪 Tests across Node.js 16, 18, 20
- 🔍 Security audits with `npm audit`
- 📝 TypeScript strict checking
- 🧹 ESLint with zero warnings policy
- 📊 Jest testing with coverage
- ✅ Build artifact verification
- 📦 Package integrity testing

### 2. Main Branch Publishing (`.github/workflows/main-publish.yml`)

**Triggers**: Pushes to `main` branch, manual dispatch
**Purpose**: Full validation + mock publishing (real publishing commented out)

**Features**:

- 🔄 Same validation as PR workflow
- 🏗️ Build artifact sharing between jobs
- 🚧 **Mock publish step** (real publishing disabled for testing)
- 🏷️ GitHub release creation
- 🛡️ Production environment protection (manual approval required)

### 3. Dependency Updates (`.github/dependabot.yml`)

**Purpose**: Automated dependency management

**Features**:

- 📅 Weekly root dependency updates
- 🎨 Weekly frontend dependency updates
- ⚙️ Monthly GitHub Actions updates
- 🏷️ Grouped updates by type (production/development)

## Required Secrets

### NPM_TOKEN

**Purpose**: NPM registry authentication for publishing
**Setup**:

1. Generate NPM access token at https://www.npmjs.com/settings/tokens
2. Choose "Automation" token type for CI/CD
3. Add to GitHub repository secrets as `NPM_TOKEN`

### CODECOV_TOKEN (Optional)

**Purpose**: Code coverage reporting
**Setup**:

1. Sign up at https://codecov.io
2. Connect your GitHub repository
3. Add provided token to GitHub secrets as `CODECOV_TOKEN`

## GitHub Repository Settings

### 1. Environment Protection Rules

```
Environment: production
Required reviewers: [your-github-username]
Wait timer: 0 minutes
```

### 2. Branch Protection Rules

```
Branch: main
Require pull request reviews: ✅
Dismiss stale reviews: ✅
Require review from code owners: ✅
Require status checks: ✅
Required status checks:
  - Build & Test (Node.js 16)
  - Build & Test (Node.js 18)
  - Build & Test (Node.js 20)
Require branches to be up to date: ✅
Require linear history: ✅
```

## Cache Strategy

The workflows implement aggressive caching for maximum speed:

| Cache Type       | Key Pattern                                         | Paths                           |
| ---------------- | --------------------------------------------------- | ------------------------------- |
| Node.js deps     | `npm-{os}-{lockfile-hash}`                          | `node_modules`                  |
| TypeScript build | `ts-build-{os}-{node-version}-{src-hash}`           | `dist/`, `tsconfig.tsbuildinfo` |
| Frontend deps    | `frontend-deps-{os}-{node-version}-{lockfile-hash}` | `frontend/node_modules`         |
| Frontend build   | `frontend-build-{os}-{node-version}-{src-hash}`     | `frontend/dist/`                |
| Jest cache       | `jest-{os}-{node-version}-{src-hash}`               | `.jest-cache`, `coverage/`      |

## Publishing Process

### Current State (Testing)

- ✅ Full build and test validation
- ✅ Package integrity verification
- 🚧 **Mock publish step** (actual publishing disabled)
- ✅ GitHub release creation

### To Enable Real Publishing

1. Uncomment the publish step in `.github/workflows/main-publish.yml`:
   ```yaml
   - name: Publish to NPM
     run: npm publish --provenance --access public
     env:
       NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```
2. Ensure `NPM_TOKEN` secret is properly configured
3. Verify package.json publishing configuration

## Security Features

- 🔒 **NPM Provenance**: Cryptographic attestation of package origin
- 🛡️ **Security Audits**: Automatic vulnerability scanning
- 🏛️ **Environment Protection**: Manual approval required for production
- 🔐 **Token Scoping**: Minimal required permissions
- 📋 **Dependency Scanning**: Automated updates with security patches

## Performance Optimizations

- ⚡ **Concurrent Jobs**: Parallel execution where possible
- 💾 **Layered Caching**: Multiple cache levels for different components
- 🎯 **Selective Triggers**: Only run on relevant file changes
- 🚀 **Fail Fast**: Stop builds early on critical failures
- 📦 **Artifact Reuse**: Share build outputs between jobs

## Monitoring & Maintenance

- 📊 **Coverage Reports**: Automated via Codecov
- 🔄 **Dependabot**: Weekly dependency updates
- 📈 **Build Times**: Monitor via GitHub Actions insights
- 🚨 **Failure Notifications**: GitHub notifications for failed builds

## Testing the Workflows

1. **Create a PR**: Should trigger `pr-validation.yml`
2. **Merge to main**: Should trigger `main-publish.yml` with mock publishing
3. **Check Actions tab**: Verify all steps complete successfully
4. **Monitor cache hits**: Should see significant speedup on subsequent runs

## Troubleshooting

### Common Issues

**Cache misses**: Check file hash patterns in cache keys
**NPM audit failures**: Update vulnerable dependencies
**TypeScript errors**: Ensure strict mode compliance
**Build artifact missing**: Verify build script completeness

### Debug Commands

```bash
# Test local build process
npm run build
npm run test:ci
npm pack --dry-run

# Verify package contents
npm publish --dry-run
```
