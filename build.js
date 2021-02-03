const fs = require('fs');
const path = require('path');
const stripJsonComments = require('strip-json-comments');

let mozillaRepo = '';
let goShrink = false;

const outputSpec = {
  prefix: 'firefox-webextensions',
  aggBase: {
    definitions: {
      permissionsList: {
        enum: [],
      },
      optionalPermissionsList: {
        enum: [],
      },
    },
    properties: {
    },
  },
  resultBase: {
    title: 'JSON schema for Firefox WebExtensions manifest file',
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: true,
    required: [ 'manifest_version', 'name', 'version' ],
    definitions: {
    },
    properties: {
    },
  },
  groupList: [
    /** APIs reside within mozilla repository. */
    {
      name: 'mozillaAPI-genaral',
      getRepository: () => { return mozillaRepo; },
      schemaDir: 'toolkit/components/extensions/schemas/',
      apiListFile: 'toolkit/components/extensions/ext-toolkit.json',
      useMdn: true,
      schemaList: [
        {
          name: 'manifest',
          schema: 'toolkit/components/extensions/schemas/manifest.json',
        },
        {
          name: 'events',
          schema: 'toolkit/components/extensions/schemas/events.json',
        },
        {
          name: 'types',
          schema: 'toolkit/components/extensions/schemas/types.json',
        },
      ],
    },
    {
      outputName: 'mozillaAPI-desktop',
      getRepository: () => { return mozillaRepo; },
      schemaDir: 'browser/components/extensions/schemas/',
      apiListFile: 'browser/components/extensions/ext-browser.json',
      useMdn: true,
      schemaList: [],
    },
  ]
};

/**
 * distill from argments.
 * @returns {Object} report
 */
const numerateArgs = () => {
  const report = {
    isValid: true,
    message: [],
  };
  process.argv.forEach((arg, idx) => {
    if(arg === '--mozilla-repo') {
      if(idx + 1 < process.argv.length) {
        mozillaRepo = process.argv[idx + 1];
      }
      else {
        report.isValid = false;
        report.message.push(`please specify as ${arg} somevalue`);
      }
    }
    else if(arg === '--shrink') {
      goShrink = true;
    }
  });
  return report;
};

/**
 * Check the structure of repository.
 * @param {string} rootDir root directory of repository
 * @returns {{isValid: boolean, message: string}} the repository has assumed dirs or not
 */
const checkRepositoryDirs = (rootDir, apiGroup) => {
  const report = {
    isValid: true,
    message: [],
  };
  if(rootDir === '') {
    report.isValid = false;
    report.message.push('Lack of arg: --mozilla-repo foo');
  }
  else if(fs.existsSync(rootDir) === false) {
    report.isValid = false;
    report.message.push(`root dir does not exist: ${rootDir}`);
  }
  else {
    const schemaDirFull = path.join(rootDir, apiGroup.schemaDir);
    if(fs.existsSync(schemaDirFull) === false) {
      report.isValid = false;
      report.message.push(`schema dir does not exist: ${apiGroup.schemaDir}`);
    }
  }
  return report;
};

const chromeUri2Path = (chromeUri) => {
  const regexSchemaPath = /.+\/([^/]+json)$/;
  //identity is in browser-ui api, but its schema is in toolkit dir. only-one case.
  if(chromeUri.startsWith('chrome://extensions/content/schemas/')) {
    return `toolkit/components/extensions/schemas/${regexSchemaPath.exec(chromeUri)[1]}`;
  }
  else if(chromeUri.startsWith('chrome://browser/content/schemas/')) {
    return `browser/components/extensions/schemas/${regexSchemaPath.exec(chromeUri)[1]}`;
  }
  else {
    return '';
  }
};

/**
 * Distill JSON file names from API schema file's content.
 * @param {string} rootDir 
 * @param {Object[]} apiGroup
 */
const makeSchemaList = (rootDir, apiGroup) => {
  if(apiGroup.apiListFile !== undefined) {
    const apiListFileFull = path.join(rootDir, apiGroup.apiListFile);
    const apiItemList = JSON.parse(stripJsonComments(fs.readFileSync(apiListFileFull, 'utf8')));
    for(const apiName in apiItemList) {
      if(apiItemList[apiName].schema !== undefined) { //only background page of mozilla?
        const schema = chromeUri2Path(apiItemList[apiName].schema);
        if(schema !== '') {
          const apiItem = {
            name: apiName,
            schema,
          };
          apiGroup.schemaList.push(apiItem);
        }
        else {
          console.log(`skipped: irregular path for ${apiName}. ${apiItemList[apiName].schema}`);
        }
      }
    }
  }
};

const aggregate = (rootDir, apiGroup, result) => {
  makeSchemaList(rootDir, apiGroup);
  const clasifiedAsPermission = [ 'Permission', 'PermissionNoPrompt' ];
  const clasifiedAsOptionalPermission = [ 'OptionalPermission', 'OptionalPermissionNoPrompt' ];
  for(const schemaItem of apiGroup.schemaList) {
    const schemaFileFull = path.join(rootDir, schemaItem.schema);
    try {
      const apiSpecList = JSON.parse(stripJsonComments(fs.readFileSync(schemaFileFull, 'utf8')));
      apiSpecList.forEach(apiSpec => {
        if(apiSpec.namespace === 'manifest'
          || apiSpec.namespace === 'experiments'
          || apiSpec.namespace === 'extensionTypes'
          ) {
          if(apiSpec.types !== undefined) { // !define is common in specific apiGroup
            for(const typ of apiSpec.types) {
              if(typ['$extend'] === 'WebExtensionManifest') {
                for(const propName of Object.keys(typ.properties)) {
                  if(result.properties[propName] !== undefined) {
                    console.log(`WARN: dup at ${apiSpec.namespace}`);
                  }
                  result.properties[propName] = typ.properties[propName];
                }
              }
              else if(clasifiedAsPermission.includes(typ['$extend'])) {
                for(const p of typ.choices[0].enum) {
                  if(result.definitions.permissionsList.enum.includes(p) === false) {
                    result.definitions.permissionsList.enum.push(p);
                  }
                  else {
                    console.log(`Perm ADD: WARN: dup at ${apiSpec.namespace}: ${p}`);
                  }
                }
              }
              else if(clasifiedAsOptionalPermission.includes(typ['$extend'])) {
                for(const p of typ.choices[0].enum) {
                  if(result.definitions.optionalPermissionsList.enum.includes(p) === false) {
                    result.definitions.optionalPermissionsList.enum.push(p);
                  }
                  else {
                    console.log(`OptPerm ADD: WARN: dup at ${apiSpec.namespace}: ${p}`);
                  }
                }
              }
              else if(typ.id) {
                if(result.definitions[typ.id] !== undefined) {
                  console.log(`WARN: dup at ${apiSpec.namespace}`);
                }
                result.definitions[typ.id] = typ;
              }
              else {
                console.log(`Not add - ${JSON.stringify(typ)}`);
              }
            }
          }
        }
        else {
          if(apiSpec.permissions) {
            for(const p of apiSpec.permissions) {
              if(result.definitions.permissionsList.enum.includes(p) === false) {
                result.definitions.permissionsList.enum.push(p);
              }
              else {
                console.log(`Perm ADD: WARN: dup at apiSpec.permissions: ${apiSpec.namespace}: ${p}`);
              }
            }
          }
        }
      });
    } catch(err) {
      // e.g. comm-central does not have a file for pkcs11, so fs.readFileSync() fails.
      console.log(`(API: ${apiGroup.name}, Schema Name: ${schemaItem.name}): ${err}`);
    }
  }
};

const cnvOptional = (member, key) => {
  if(member.optional !== undefined) {
    if(typeof member.optional === 'boolean') {
      if(member.optional) {
        member.optional = undefined;
      }
      else {
        console.log(`member.optional is false: ${key}`);
      }
    }
    else {
      // only for "default_locale".optional = "true" (string)
      if(member.optional === 'true') {
        member.optional = undefined;
      }
      console.log(`error on optional: ${key}`);
    }
  }
  // huh, maybe 'optional: undefined' means 'required'
  // excludeing almost of 'difinition' part.
  // else {
  //   console.log(`no opt ${key}`);
  // }
};

const cnvType = member => {
  if(member.type === 'integer') {
    member.type = 'number';
  }
  else if(member.type === 'any') {
    member.type = [
      'string',
      'number',
      'object',
      'array',
      'boolean',
      'null',
    ];
  }
};

const convertSub = (tree, rootName, isDefinition) => {
  if(isDefinition && tree.id) {
    tree.id = undefined;
  }

  if(tree.choices) {
    if(tree.choices.length === 1) {
      convertSub(tree.choices[0], '', isDefinition); // only 2 cases, so maybe meaningless
      for(const key of Object.keys(tree.choices[0])) {
        tree[key] = tree.choices[0][key];
      }
    }
    else {
      for(const elm of tree.choices) {
        convertSub(elm, '', isDefinition);
      }
      tree.oneOf = tree.choices;
    }
    tree.choices = undefined;
  }

  if(tree['$ref']) {
    if(tree['$ref'].includes('.')) {
      tree['$ref'] = `#/definitions/${tree['$ref'].slice(1 + tree['$ref'].indexOf('.'))}`;
    }
    else {
      tree['$ref'] = `#/definitions/${tree['$ref']}`;
    }
  }
  if(tree.preprocess) {
    // all 'preprocess' are 'localize'
    if(tree.description) {
      tree.description = `${tree.description}\npreprocess: ${tree.preprocess}`;
    }
    else {
      tree.description = `preprocess: ${tree.preprocess}`;
    }
    tree.preprocess = undefined;
  }
  if(tree.onError) {
    // all 2 'onError' are 'warn'
    // ManifestBase - author, WebExtensionManifest - content_security_policy
    if(tree.description) {
      tree.description = `${tree.description}\nonError: ${tree.onError}`;
    }
    else {
      tree.description = `onError: ${tree.onError}`;
    }
    tree.onError = undefined;
  }
  if(tree.deprecated !== undefined) {
    // 'deprecated' are 'additionalProperties' and others
    if(typeof tree.deprecated === 'boolean') {
      // cloudFile's 2 cases
      if(tree.deprecated) {
        if(tree.description) {
          tree.description = `*deprecated!* \n${tree.description}`;
        }
        else {
          tree.description = `*deprecated!*`;
        }
      }
    }
    else {
      if(tree.description) {
        tree.description = `*deprecated!* ${tree.deprecated}\n${tree.description}`;
      }
      else {
        tree.description = `*deprecated!* ${tree.deprecated}`;
      }
    }
    tree.deprecated = undefined;
  }
  cnvOptional(tree, rootName);
  cnvType(tree);
  if(tree.type === 'array') {
    // only 2 cases, so maybe meaningless
    convertSub(tree.items, `${rootName}.array.items`, isDefinition);
  }
  else if(tree.type === 'string' && tree.pattern) {
    if(tree.pattern.startsWith('(?i)')) {
      tree.pattern = tree.pattern.replace(/a-f/g, 'a-fA-F')
        .replace(/a-z/g, 'a-zA-Z')
        .replace(/^\(\?i\)(.+)$/, '$1');
    }
  }
  if(tree.properties) {
    for(const key of Object.keys(tree.properties)) {
      convertSub(tree.properties[key], key, isDefinition);
    }
  }
  if(tree.additionalProperties) {
    // only for properties - commands
    convertSub(tree.additionalProperties, `${rootName}.additionalProperties`, isDefinition);
  }
  if(tree.patternProperties) {
    // only for definitions - WebExtensionLangpackManifest - sources
    for(const key of Object.keys(tree.patternProperties)) {
      convertSub(tree.patternProperties[key], key, isDefinition);
    }
  }
};

const convertRoot = raw => {
  const result = outputSpec.resultBase;
  for(const key of Object.keys(raw.definitions.ManifestBase.properties)) {
    result.properties[key] = JSON.parse(JSON.stringify(raw.definitions.ManifestBase.properties[key]));
  }
  for(const key of Object.keys(raw.definitions.WebExtensionManifest.properties)) {
    result.properties[key] = JSON.parse(JSON.stringify(raw.definitions.WebExtensionManifest.properties[key]));
  }
  result.properties.additionalProperties = JSON.parse(JSON.stringify(raw.definitions.WebExtensionManifest.additionalProperties));
  for(const key of Object.keys(raw.definitions.WebExtensionLangpackManifest.properties)) {
    result.properties[key] = JSON.parse(JSON.stringify(raw.definitions.WebExtensionLangpackManifest.properties[key]));
  }
  for(const key of Object.keys(raw.definitions.WebExtensionDictionaryManifest.properties)) {
    result.properties[key] = JSON.parse(JSON.stringify(raw.definitions.WebExtensionDictionaryManifest.properties[key]));
  }
  for(const key of Object.keys(raw.definitions.ThemeManifest.properties)) {
    if(key !== 'icons') {
      result.properties[key] = JSON.parse(JSON.stringify(raw.definitions.ThemeManifest.properties[key]));
    }
  }
  for(const key of Object.keys(raw.definitions)) {
    if(key !== 'ManifestBase' && key !== 'WebExtensionManifest'
      && key !== 'WebExtensionLangpackManifest'
      && key !== 'WebExtensionDictionaryManifest'
      && key !== 'ThemeManifest'
      ) {
      result.definitions[key] = JSON.parse(JSON.stringify(raw.definitions[key]));
    }
  }
  for(const key of Object.keys(raw.properties)) {
    result.properties[key] = JSON.parse(JSON.stringify(raw.properties[key]));
  }
  for(const key of Object.keys(result.definitions)) {
    convertSub(result.definitions[key], key, true);
  }
  for(const key of Object.keys(result.properties)) {
    convertSub(result.properties[key], key, false);
  }
  for(const perm of result.definitions.permissionsList.enum) {
    let wk = perm;
    if(perm.includes(':')) {
      wk = perm.slice(1 + perm.indexOf(':'));
    }
    if(!result.definitions.Permission.oneOf[2]) {
      result.definitions.Permission.oneOf.push({ type: 'string', enum: [] });
    }
    if(result.definitions.Permission.oneOf[2].enum.includes(wk) === false) {
      result.definitions.Permission.oneOf[2].enum.push(wk);
    }
  }
  result.definitions.permissionsList = undefined;
  for(const perm of result.definitions.optionalPermissionsList.enum) {
    let wk = perm;
    if(perm.includes(':')) {
      wk = perm.slice(1 + perm.indexOf(':'));
    }
    if(result.definitions.OptionalPermission.oneOf[1].enum.includes(wk) === false) {
      result.definitions.OptionalPermission.oneOf[1].enum.push(wk);
    }
  }
  result.definitions.optionalPermissionsList = undefined;
  return result;
};

const isValidEnv = (report) => {
  report.message.forEach(m => {
    console.log(m);
  });
  return report.isValid;
};

const program = () => {
  if(isValidEnv(numerateArgs()) === false) {
    return;
  }
  const agg = outputSpec.aggBase;
  outputSpec.groupList.forEach(apiGroup => {
    const tgtRepo = apiGroup.getRepository();
    if(tgtRepo !== '' && isValidEnv(checkRepositoryDirs(tgtRepo, apiGroup))) {
      aggregate(tgtRepo, apiGroup, agg);
    }
  });
  fs.writeFileSync('ffext.raw.json', JSON.stringify(agg, null, 2));
  const result = convertRoot(agg);
  if(goShrink) {
    fs.writeFileSync('ffext.min.json', JSON.stringify(result));
  }
  fs.writeFileSync('ffext.json', JSON.stringify(result, null, 2));
};

program();

// vim:expandtab ff=unix fenc=utf-8 sw=2
