# ctl-models

`ctl-models` is a lightweight framework to manage tables and schemas. Tried and tested in production.

Currently works with MySQL dialect, but is most likely easily extendible to other DBs.

## Features

- Ability to track/compare then modify columns automatically
- Automatically create nicely named getter/update/remove functions for each model
- Support for custom fields
- Support for transactions (commit & rollback)

## Installation

```bash
yarn add ctl-models
```

## Usage

You must define the name and fields for your models:
```js
const models = require('ctl-models');
```

After you define the models, you simply provide the `init()` function with the models, a way to query the DB and an optional logging method. The `init` function will return the functions you need, for example:
```js
// In library/db.js
const log = require('better-logs')('models');
const db = ...; // Refer to DB Wrapper for details

const User = {
  name: 'User',
  fields: {
    id: { type: 'id' },
    name: { type: 'text', length: 'extended' },
    email: { type: 'email' },
    password: { type: 'text', length: 'long' },
    createdAt: { type: 'date' },
  },
  indices: [
    { type: 'unique', fields: ['email'] },
    { type: 'tree', fields: ['name'], sort: ['createdAt DESC'] },
  ],
};

const MODEL_DEFNS = [
  User,
];

exports.init = async () => {
  const { fns } = await models.init({ models: MODEL_DEFNS, log, db });
  Object.assign(exports, fns);
};
```

Then when your server starts, simply do
```js
await db.init();
```

And now you can use all of the model functions with the db library (see below for details of all the functions you can call).
```js
await db.ensureAllTables();
await db.getUsers();
await db.getUserById(userId);
// etc, etc
```

## Anatomy of the Model Definition

We will base the rest of our docs on a simple model definition like this.
```js
const User = {
  
  // Name can be a string representing the singular name
  // and we will automatically select the plural and table name.
  name: {
    singular: 'user',
    plural: 'users',
    tableName: 'user_table_name',
  },
  
  // Fields must be a Field class, or an object with a type property.
  // Valid Field types are listed below.
  fields: {
    id: { type: 'id' },
    name: { type: 'text', length: 'extended' },
    email: { type: 'email' },
    password: { type: 'text', length: 'long' },
    createdAt: { type: 'date' },
  },
  
  // Indices can be unique, tree or hash.
  // Hash and tree indices do not need to be unique, and may contain a sort array.
  // Sort array can include ASC or DESC to indicate the sort order.
  indices: [
    { type: 'unique', fields: ['email'] },
    { type: 'tree', fields: ['name'], sort: ['createdAt DESC'] },
  ],

  // Optionally you can set a map function so that all rows that are returned
  // goes through this map before returning. Useful if you want to wrap the data
  // around a class, or add additional properties before using it.
  map: (row) => row,
};
```

### List of Field Types

You can access the `Field` class, and all pre-defined types are in `Types`:
```js
const { Field, Types } = require('ctl-models');
const TextField = Types.text; // Class that extends Field, that is used to store text
```

- *id* - Integer ID field, auto increments, defaults to being a primary key.
- *ref* - References an Integer ID, but you can change `refType` (type of referencing column) and `ref` (model you are referring to).
- *text* - Stores text string, you can specify a `size`, like "short", "medium", "long" or a specific max number.
- *number* - Stores a number, you can specify a `size`. Also you can set `float` to true, and specify its `precision` (number of digits after decimal.)
- *num* - Same as number.
- *date* - Stores a `Date` object.
- *json* - Stores the value as a JSON string.
- *email* - Stores an email, and will even validate to ensure it's a real email.

... more fields to come! Feel free to contribute some of your own!


## List of Functions

All functions are `async` functions, so you should use `await` to wait for its completion.

### Table Management

- *ensureAllTables()* - Creates the tables or updates them with the fields in the model. Recommended to call this before using any other functions.
- *dropAllTables()* - Removes all of the tables and their data!

### Model Functions

- *createUser(createObj)* - Creates a new user, with the fields in `createObj`
- *getUsers(viewOptions)* - Gets users matching the view options (see view options below)
- *getUserById(id)* - Gets a single user by matching ID
- *getUserByEmail(id)* - Gets a single user by matching email
- *getUsersByName(name, viewOptions)* - Gets all users matching name, with view options
- *updateUserById(id, updateObj)* - Updates a single user with ID, the fields in `updateObj` (can be a partial update.)
- *updateUserByEmail(email, updateObj)* - Updates a single user with email, with the fields in `updateObj`
- *updateUsersByName(name, updateObj)* - Updates all users with name, with the fields in `updateObj`
- *deleteUserById(id)* - Deletes a single user with ID
- *deleteUserByEmail(email)* - Deletes a single user with email
- *deleteUsersByName(name)* - Deletes all users with matching name


#### View Options
- *limit* - Limit number of results
- *offset* - Offset amount to skip from beginning
- *sort* - Array of props and its direction, like `['createdAt DESC']` to indicate the sort order.
- *fields* - Array of props to include in the result, like `['name', 'email']`. By default all fields are included.
- *filter* - Array of objects with `{ op: '=', value: 'something' }` as additional matching criteria.
- *map* - You can define a function that takes in each item and transform it. Eg: `(user) => user.name` would now return an array of names instead of user objects.

### DB Wrapper

Here is a simple wrapper using `promise-mysql`:
```js
const MySQL = require('promise-mysql');
class Conn {
  constructor(conn) {
    this.conn = conn;
  }
  async query(...args) {
    return this.conn.query(...args);
  }
  release() {
    pool.releaseConnection(this.conn);
  }
  async commit() {
    try {
      const result = await this.conn.commit();
      this.release();
      return result;
    } catch (e) {
      await this.rollback();
      throw e;
    }
  }
  async rollback() {
    await this.conn.rollback();
    this.release();
  }
}

let pool;
exports.connect = async () => {
  pool = MySQL.createPool({
    host: 'localhost',
    port: 3306,
    database: 'my_db',
  });
};
exports.getConnection = async () => {
  const conn = await pool.getConnection();
  return new Conn(conn);
}
exports.transaction = async () => {
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  return new Conn(conn);
};
```

## Advanced Usage

`ctl-models` is highly customizable. You can define your own `Field`s, and use them to easily convert your app data format into your database format. You can even validate the values and represent multiple columns in a single property value.

### Custom Fields

Below is how you would define a custom field, and the functions you can override.
```js
const { Field } = require('ctl-models');
class CustomField extends Field {
  async validate(value) {
    // If the value is no good, return an error. Otherwise return nothing.
  }
  getColumnType() {
    return 'VARCHAR(212)'; // Or some other column type
  }

  // For documentation
  getReadableType() {
    return 'string' // For documentation purposes
  }
  getReadableName() {
    return 'my custom column'; // Name for documentation
  }
  getCodeName() {
    return 'variableName'; // Name of variable for documentation
  }

  // For queries
  getWhereClause(op, query) {
    // Handle different types of queries.
    // Given an (op and query), provide a SQL clause to add to the WHERE statement, as well as params.
    return {
      clause: `${this.columnName} ${op} ?`,
      params: [query],
    };
  }

  // For table schema
  getSortColumn() {
    // In case your field uses multiple columns, indicate which column is sortable
    return this.columnName;
  }
  getColumns() {
    // Return all the columns you will need to construct the value
    return [this.columnName];
  }
  getSchema() {
    // Return an object with each column and its type
    return {
      [this.columnName]: this.getColumnType(),
    };
  }

  // For transforming data
  async getValueFromRow(rowObj) {
    // This function converts a given row into its actual value -
    // the field may want to combine column values from the db, massage the data, etc
    // before returning its value in a more accessible way.
    return value;
  }
  async getRowFromValue(value, context) {
    // This function does the inverse: it converts the given value
    // into the column values as defined in its schema. It should follow
    // the same format as its getSchema call.
    // Context is the whole update or create object, in case it is necessary to
    // determine the value of the columns.
    return {
      [this.columnName]: value,
    };
  }
}
```

You can use the `CustomField` model like so:
```js
const MyModel = {
  fields: {
    custom: new CustomField({ ...opts }),
  }
};
```

### Meta Table and Prefixes

In order to keep track of the schema structure, we use a meta table, which we default to calling `meta_schema`. This will be created in your DB. You can pass in a different name to `metaTable` to the `init` function.

You can also set a table prefix for the tables `ctl-models` creates by specificying `tablePrefix` and passing it to the `init` function.

## Contact & Licensing ##

Feel free to use this for whatever you like, but don't blame me if someone loses an eye.

If you are using this, I'd love to hear about your project. It's great to know my code was helpful to someone!

[Leander Lee][1]<br />
me@leander.ca

[1]: http://leander.ca











