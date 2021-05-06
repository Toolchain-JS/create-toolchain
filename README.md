# Toolchain CLI - project initialization utility

Toolchain CLI is a framework and bundler agnostic JavaScript project initialization utility.

With Toolchain CLI you can initialize project in any JavaScript framework (React, Preact, VueJS, ...) and build it with
any bundler (Webpack, Parcel, Rollup, ...) Projects are initialized by running CLI with pre-defined template:

```shell
$ npx create-toolchain project-name --template [template-name]
```

For more options check `npx create-toolchain --help`. To run our example template & toolchain please check:

```shell
$ npx create-toolchain project-name --template @toolchain-js/rollup-library
```

## How it works?

Toolchain CLI provides interface for downloading and initializing project folder and file structure from the template. 
Template authors defines this structure, as well as a toolchain scripts that will be responsible for project bundling.
Several templates may share the same toolchain for bundling, while template may only use one toolchain.

Next two chapters explain how you can create your own template and build toolchain. You can also check example packages 
in [Toolchain-JS/toolchain-examples](https://github.com/Toolchain-JS/example-toolchains). 

## Anatomy of a template package

We recommend naming template package with `tjs-template-*` prefix. Later, when starting project, it may be used without 
the prefix. Also, it is possible to combine template name with package scope:

```shell
$ npx create-toolchain my-project-name --template tjc-template-my-project-template
$ npx create-toolchain my-project-name --template my-project-template
$ npx create-toolchain my-project-name --template @my-scope/tjs-template-my-project-template
$ npx create-toolchain my-project-name --template @my-scope/my-project-template
```

A template package should follow this structure:

```text
tjs-template-[template-name]/       # should start with tjs-template-*
  README.md                         # template documentation file
  package.json
  template.json                     # template manifest file
  template/                         # anything placed here will be copied to project
    README.md                       # project documentation file
    src/
      index.js
```

`template.json` manifest file contains two keys, `toolchain` and `package`. `toolchain` points to the name and version 
of toolchain package to be used for bundling template. `package` key lets you provide any keys/values that you want 
added to the new project's `package.json`, such as dependencies and any custom scripts that your template relies on.
Toolchain package is responsible for mapping those key/values in appropriate way for the given bundling process.   

Below is an example for `template.json` file:

```json
{
  "toolchain": "@toolchain-js/toolchain-rollup-bundler",
  "package": {
    "name": "project-name",
    "private": true,
    "dependencies": {
      "qs": "^6.6.0"
    }
  }
}
```

## Anatomy of a toolchain package

A toolchain package should follow this structure:

```text
toolchain-[toolchain-name]/         # recommended to start with toolchain-*
  README.md                         # toolchain documentation file
  scripts/
    init.js                         # toolchain initialization file
```

Toolchain package may also contain any other code you need for executing and calling during project lifecycle. Like 
development server starting script, [binary executables](https://docs.npmjs.com/cli/v7/configuring-npm/package-json#bin),
production build script, test execution script, etc... 

Toolchain CLI only expects to find `scripts/init.js` file and callable function inside toolchain package. During 
initialization this function will be called, so any custom toolchain/template related setup may be executed in it: 

```js
'use strict';

const fs = require('fs-extra');

module.exports = function (
    projectPath,
    projectName,
    template,
    programDirectory
) {
    // Map template package.js key/values 
    const projectPackage = require(path.join(projectPath, 'package.json'));
    const templatePackage = template['package'] || {};
    
    Object.keys(templatePackage).forEach(key => {
        if (key === 'name') {
            projectPackage[key] = (templatePackage[key] || 'project-name').replace('project-name', projectName);
            return;
        }
        projectPackage[key] = templatePackage[key];
    });

    fs.writeFileSync(
        path.join(projectPath, 'package.json'),
        JSON.stringify(projectPackage, null, 2) + os.EOL,
    );

    // Copy template files
    const templateDir = path.join(template['path'], 'template');
    if (fs.existsSync(templateDir)) {
        fs.copySync(templateDir, projectPath);
    } else {
        console.error(`Could not locate supplied template: ${chalk.green(templateDir)}`);
        return;
    }

    // Remove Toolchain CLI template from dependencies
    const proc = spawn.sync('npm', ['uninstall', template['name']], {
        stdio: 'inherit',
    });
    if (proc.status !== 0) {
        console.error(`\`${command} ${args.join(' ')}\` failed`);
        return;
    }
};
```

You may use the example above as a starting point for your toolchain. The minimum that `scripts/init.js` needs to do is:
 * map template `package.json` keys/values to new project's `package.json`;
 * copy template files to new project;
 * remove template dependency from the new project. 

For more things that could be done in toolchain package please check example packages in 
[Toolchain-JS/toolchain-examples](https://github.com/Toolchain-JS/example-toolchains).

### Parameters given to the `scripts/init.js`: 

### `projectPath` & `projectName`

Path to new project directory and project's name.

### `template`

Contains the values from the manifest, plus few additional:
* `name` name and version of template package
* `path` path to the template package in project's `node_modules`
* `toolchain` name and version of toolchain package
* `package` template keys/values that will be added to the new project's `package.json`

### `programDirectory`

Path to directory where user initiated Toolchain CLI.

### `..restParameters`

From the Toolchain CLI, these flags are also passed: `verbose`, `useYarn` (in that order).

## Inspiration and credits

Toolchain CLI is heavily inspired by framework specific CLIs like create-react-app, Vue CLI, and other. Main inspiration
for "template/scripts" approach comes from [create-react-app](https://github.com/facebook/create-react-app).  
