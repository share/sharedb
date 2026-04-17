const jsEslint = require("@eslint/js");
const {
    defineConfig,
    globalIgnores,
} = require("eslint/config");
const eslintConfigGoogle = require('eslint-config-google');
const tsEslint = require('typescript-eslint');

// The ESLint ecmaVersion argument is inconsistently used. Some rules will ignore it entirely, so if the rule has
// been set, it will still error even if it's not applicable to that version number. Since Google sets these
// rules, we have to turn them off ourselves.
var DISABLED_ES6_OPTIONS = {
    'no-var': 'off',
    'prefer-rest-params': 'off'
};

var SHAREDB_RULES = {
    // Comma dangle is not supported in ES3
    'comma-dangle': ['error', 'never'],
    // We control our own objects and prototypes, so no need for this check
    'guard-for-in': 'off',
    // Google prescribes different indents for different cases. Let's just use 2 spaces everywhere. Note that we have
    // to override ESLint's default of 0 indents for this.
    indent: ['error', 2, {
        SwitchCase: 1
    }],
    'linebreak-style': 'off',
    // Less aggressive line length than Google, which is especially useful when we have a lot of callbacks in our code
    'max-len': ['error',
        {
            code: 120,
            tabWidth: 2,
            ignoreUrls: true
        }
    ],
    // Google overrides the default ESLint behaviour here, which is slightly better for catching erroneously unused
    // variables
    'no-unused-vars': ['error', {
        vars: 'all',
        args: 'after-used',
        // This can be removed once the minimum ES version is ES2019 or newer, and catch statements
        // are updated to use optional catch binding.
        caughtErrors: 'none',
    }],
    // It's more readable to ensure we only have one statement per line
    'max-statements-per-line': ['error', { max: 1 }],
    // ES3 doesn't support spread
    'prefer-spread': 'off',
    // as-needed quote props are easier to write
    'quote-props': ['error', 'as-needed'],
    'require-jsdoc': 'off',
    'valid-jsdoc': 'off',
};

module.exports = defineConfig([
    {
        extends: [eslintConfigGoogle],
        files: ["**/*.js"],
        ignores: ["eslint.config.js", "lib/**"],

        languageOptions: {
            ecmaVersion: 3,
            sourceType: "commonjs",

            parserOptions: {
                allowReserved: true,
            },
        },

        rules: Object.assign({}, DISABLED_ES6_OPTIONS, SHAREDB_RULES),
    },
    // {
    //     extends: [
    //         jsEslint.configs.recommended,
    //         tsEslint.configs.recommended,
    //     ],
    //     files: ["**/*.ts"],
    // },
    globalIgnores(["docs/"]),
    {
        files: ["examples/counter-json1-vite/*.js"],

        languageOptions: {
            ecmaVersion: 2015,
            sourceType: "module",

            parserOptions: {
                allowReserved: false,
            },
        },

        rules: {
            quotes: ["error", "single"],
        },
    }
]);
