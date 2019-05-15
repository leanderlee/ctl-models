const validator = require('email-validator');
const objHash = require('object-hash');
const _ = require('lodash');
const NOOP = () => {};

// TODO:
// enum field
// min/max size text
// nested objects
// views (shortcut for viewOptions)
// joins (deferred)

function connifyAndRelease(db, fns, baseFnName) {
  return async (...args) => {
    const conn = await db.getConnection();
    const result = await fns[`${baseFnName}WithConn`](conn, ...args);
    conn.release();
    return result;
  };
}

function connifyAndCommit(db, fns, baseFnName) {
  return async (...args) => {
    const conn = await db.transaction();
    const result = await fns[`${baseFnName}WithConn`](conn, ...args);
    await conn.commit();
    return result;
  };
}

class Field {
  constructor(opts = {}) {
    this.opts = opts;
    this.description = opts.description;
    this.required = !!opts.required;
    this.defaultValue = opts.default;
  }
  setProp(prop) {
    this.name = this.opts.name || _.startCase(prop);
    this.argName = this.opts.argName || _.camelCase(prop);
    this.codeName = this.opts.codeName || _.upperFirst(this.argName);
    this.columnName = this.opts.columnName || _.snakeCase(prop);
  }
  async validate(value) {
    // pass
  }
  getColumnType() {
    throw new Error('not_implemented_get_column_type');
  }
  getReadableType() {
    throw new Error('not_implemented_get_readable_type');
  }
  isRequired() {
    return this.required;
  }

  // For documentation
  getReadableName() {
    return this.name;
  }
  getCodeName() {
    return this.codeName;
  }
  getArgument(description = this.description) {
    return {
      name: this.argName,
      type: this.getReadableType(),
      description,
    };
  }

  // For queries
  getWhereClause(op, query) {
    return {
      clause: `${this.columnName} ${op} ?`,
      params: [query],
    };
  }
  getSortColumn() {
    return this.columnName;
  }

  // For schema
  getColumns() {
    return [this.columnName];
  }
  getSchema() {
    return {
      [this.columnName]: this.getColumnType(),
    };
  }
  async getValueFromRow(rowObj) {
    const value = rowObj[this.columnName];
    if (this.defaultValue !== undefined && (value === undefined || value === null)) {
      return this.defaultValue;
    }
    return value;
  }
  async getRowFromValue(value, context) {
    return {
      [this.columnName]: value,
    };
  }

  // For models
  async getRowObject(value, context) {
    const validationError = await this.validate(value, context);
    if (validationError || validationError === true) {
      throw validationError;
    }
    return this.getRowFromValue(value, context);
  }
}

exports.Field = Field;

class TextField extends Field {
  constructor(opts) {
    super(opts);
    this.length = opts.length;
  }
  getColumnType() {
    const length = Number(this.length);
    if (isNaN(length)) {
      if (this.length === 'double-extended') {
        return 'VARCHAR(511)';
      } else if (this.length === 'extended') {
        return 'VARCHAR(255)';
      } else if (this.length === 'medium') {
        return 'VARCHAR(127)';
      } else if (this.length === 'short') {
        return 'VARCHAR(63)';
      } else if (this.length === 'tiny') {
        return 'VARCHAR(31)';
      }
      return 'TEXT';
    } else if (length == Infinity) {
      return 'TEXT';
    } else {
      return `VARCHAR(${length})`;
    }
  }
  getReadableType() {
    return 'string';
  }
}

class IdField extends Field {
  constructor(opts) {
    super(opts);
    this.autoInc = (opts.autoInc === undefined ? true : !!opts.autoInc);
    this.primaryKey = (opts.primaryKey === undefined ? true : !!opts.primaryKey);
  }
  getColumnType() {
    return `BIGINT${this.autoInc ? ' AUTO_INCREMENT' : ''}${this.primaryKey ? ' PRIMARY KEY' : ''}`
  }
  getReadableType() {
    return 'int';
  }
}

class RefField extends Field {
  constructor(opts) {
    super(opts);
    this.ref = opts.ref;
    this.refType = opts.refType || 'BIGINT';
    this.readableType = opts.readableType || 'int';
  }
  getColumnType() {
    return this.refType;
  }
  getReadableType() {
    return this.readableType;
  }
}

class NumberField extends Field {
  constructor(opts) {
    super(opts);
    this.float = (opts.float === undefined ? false : !!opts.float);
    this.size = opts.size;
    this.precision = Number(opts.precision);
  }
  getColumnType() {
    const size = Number(this.size);
    if (this.float) {
      const precision = isNaN(this.precision) ? 3 : this.precision;
      if (isNaN(size)) {
        if (this.size === 'medium') {
          return `DECIMAL(10, ${precision})`;
        } else if (this.size === 'small') {
          return `DECIMAL(5, ${precision})`;
        } else if (this.size === 'tiny') {
          return `DECIMAL(2, ${precision})`;
        }
        return `DECIMAL(20, ${precision})`;
      } else if (size == Infinity) {
        return `DECIMAL(40, ${precision})`;
      } else {
        return `DECIMAL(${size}, ${precision})`;
      }
    } else {
      if (isNaN(size)) {
        if (this.size === 'medium') {
          return 'INT';
        } else if (this.size === 'small') {
          return 'MEDIUMINT';
        } else if (this.size === 'tiny') {
          return 'SMALLINT';
        } else if (this.size === 'extra-tiny') {
          return 'TINYINT';
        }
        return 'BIGINT';
      } else if (size == Infinity) {
        return 'BIGINT';
      } else {
        return `INT(${size})`;
      }
    }
  }
  getReadableType() {
    return 'number';
  }
}

class DateTimeField extends Field {
  getColumnType() {
    return 'DATETIME';
  }
  getReadableType() {
    return 'Date';
  }
}

class JsonField extends Field {
  async getValueFromRow(rowObj) {
    const jsonStr = rowObj[this.columnName];
    if (!jsonStr) return {};
    return JSON.parse(jsonStr);
  }
  async getRowFromValue(value) {
    return { [this.columnName]: JSON.stringify(value) };
  }
  getColumnType() {
    return 'TEXT';
  }
  getReadableType() {
    return 'json';
  }
}

class EmailField extends TextField {
  async validate(value) {
    if (!validator.validate(value)) {
      return new Error('invalid_email');
    }
  }
  getColumnType() {
    return 'VARCHAR(320)';
  }
  getReadableType() {
    return 'email';
  }
}

const FIELD_TYPES = {
  id: IdField,
  ref: RefField,
  text: TextField,
  number: NumberField,
  num: NumberField,
  date: DateTimeField,
  json: JsonField,
  email: EmailField,
};

exports.Types = FIELD_TYPES;

function getWhereMatching(props = [], values = [], fields = {}) {
  const where = [];
  const params = [];
  props.forEach((prop, i) => {
    const { clause, params: additionalParams } = fields[prop].getWhereClause('=', values[i]);
    where.push(clause);
    params.push(...additionalParams);
  });
  return { where, params };
}

async function getSettersFromUpdateObj(updateObj = {}, fields = {}) {
  const setter = [];
  const params = [];
  await Promise.all(
    Object.keys(updateObj).map(async (prop) => {
      const field = fields[prop];
      if (field) {
        const value = updateObj[prop];
        const rowObj = await field.getRowObject(value, updateObj);
        Object.keys(rowObj).forEach((column) => {
          setter.push(`${column} = ?`);
          params.push(rowObj[column]);
        });
      }
    })
  )
  return { setter, params };
}

function getColumnNamesForSelect(fields, viewFields = []) {
  let columnNames = '*';
  if (viewFields.length > 0) {
    columnNames = viewFields.map(prop => {
      const field = fields[prop];
      if (!field) throw new Error(`missing_field_${prop}`);
      return field.getColumns().join(',')
    }).join(',');
  }
  return columnNames;
}

async function getObjectFromRow(row, fields = {}, viewProps = [], finalMap) {
  const props = (viewProps.length > 0 ? viewProps : Object.keys(fields));
  const obj = {};
  await Promise.all(
    props.map(async (prop) => {
      const field = fields[prop];
      const value = await field.getValueFromRow(row);
      Object.assign(obj, { [prop]: value });
    })
  )
  if (typeof finalMap === 'function') {
    return finalMap(obj);
  }
  return obj;
}

function getNames(name, tablePrefix) {
  let names = name;
  if (typeof name === 'string') {
    names = { singular: name };
  }
  const singularName = names.singular;
  const pluralName = names.plural || `${singularName}s`;
  return {
    singularName: _.toLower(singularName),
    pluralName: _.toLower(pluralName),
    singularTitle: names.singularTitle || _.upperFirst(_.camelCase(singularName)),
    pluralTitle: names.pluralTitle || _.upperFirst(_.camelCase(pluralName)),
    tableName: `${tablePrefix}${names.tableName || _.snakeCase(pluralName)}`,
  };
}

function getFieldsInfo(defns = {}) {
  const schema = {};
  const fields = {};
  Object.keys(defns).forEach((prop) => {
    const defn = defns[prop];
    if (defn instanceof Field) {
      defn.setProp(prop);
      fields[prop] = defn;
    } else if (typeof defn === 'object') {
      const fieldType = defn.type;
      const Type = FIELD_TYPES[fieldType];
      if (!Type) throw new Error(`unknown_type_${fieldType}`);
      const field = new Type(defn);
      field.setProp(prop);
      fields[prop] = field;
    } else {
      throw new Error(`unknown_field_defn_${defn}`);
    }
    Object.assign(schema, fields[prop].getSchema());
  });
  return { schema, fields };
}

function getIndexInfo(defns = [], fields = {}, tableName) {
  const indices = {};
  const uniques = defns.filter(idx => idx.type === 'unique').map(idx => idx.fields);
  const queries = defns.filter(idx => (idx.type === 'tree' || idx.type === 'hash'));
  defns.forEach((index) => {
    const columns = [];
    if (index.type === 'unique') {
      const { fields: uniqueProps = [] } = index;
      uniqueProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      const indexName = `idx_uniq_${objHash(columns)}`;
      indices[indexName] = `UNIQUE INDEX ${indexName} ON ${tableName} (${columns.join(',')})`;
    } else if (index.type === 'fulltext') {
      const { fields: uniqueProps = [] } = index;
      uniqueProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      const indexName = `idx_ft_${objHash(columns)}`;
      indices[indexName] = `FULLTEXT INDEX ${indexName} ON ${tableName} (${columns.join(',')})`;
    } else if (index.type === 'hash') {
      const { fields: indexProps = [], sort: sortProps = [] } = index;
      indexProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      sortProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      const indexName = `idx_hash_${objHash(columns)}`;
      indices[indexName] = `INDEX ${indexName} USING HASH ON ${tableName} (${columns.join(',')})`;
    } else if (index.type === 'tree') {
      const { fields: indexProps = [], sort: sortProps = [] } = index;
      indexProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      sortProps.forEach((propAndDir) => {
        const [prop, dir = 'ASC'] = propAndDir.split(' ');
        const field = fields[prop];
        if (!field) throw new Error(`unknown_field_${prop}`);
        columns.push(`${field.getSortColumn()} ${dir}`);
      });
      const indexName = `idx_btree_${objHash(columns)}`;
      indices[indexName] = `INDEX ${indexName} USING BTREE ON ${tableName} (${columns.join(',')})`;
    }
  });
  return { indices, uniques, queries };
}

function handleViewOptions(fields, viewOptions = {}) {
  const {
    fields: viewFields = [],
    filters = [],
    sort: sortFields = [],
    limit,
    offset,
    map,
  } = viewOptions;
  const params = [];
  const sortColumns = [];
  const where = [];
  const columnNames = getColumnNamesForSelect(fields, viewFields);
  sortFields.forEach((propAndDir) => {
    const [prop, dir = 'ASC'] = propAndDir.split(' ');
    const field = fields[prop];
    if (!field) throw new Error(`unknown_field_${prop}`);
    sortColumns.push(`${field.getSortColumn()} ${dir}`);
  });
  filters.forEach((filter) => {
    if (filter && filter.prop && fields[filter.prop]) {
      const { clause, params: additionalParams } = fields[filter.prop].getWhereClause(filter.op, filter.value);
      where.push(clause);
      params.push(...additionalParams);
    }
  });
  return {
    viewFields,
    columnNames,
    where,
    params,
    sortColumns,
    limit,
    offset,
    map,
  };
}

exports.init = async (opts = {}) => {
  const {
    models: modelDefns = {},
    db = null,
    log = { info: NOOP, debug: NOOP },
    tablePrefix = '',
    metaTable = 'meta_schema',
  } = opts;
  const fns = {};
  const fnIndex = {
    schema: {},
    create: {},
    getter: {},
    update: {},
    delete: {},
  };
  const models = {};
  modelDefns.forEach(async (defn = {}) => {
    const {
      name,
      fields: fieldDefns = {},
      indices: indexDefns = [],
      map: finalMap,
    } = defn;
    const names = getNames(name, tablePrefix);
    const {
      singularName,
      pluralName,
      singularTitle,
      pluralTitle,
      tableName,
    } = names;
    const { schema, fields } = getFieldsInfo(fieldDefns);
    const { uniques, queries, indices } = getIndexInfo(indexDefns, fields, tableName);
    const tableHash = objHash({ schema, indices });
    const tableSchemaJson = JSON.stringify({ schema, indices });
    const getListOptionsArg = {
      name: 'viewOptions',
      type: 'object{fields, sort, limit, offset}',
      description: `Options for fetching ${pluralName}.`,
    };
    const getFieldsArg = {
      name: 'fields',
      type: '[string]',
      description: `Fields to fetch for ${singularName}.`,
      default: 'all fields',
    };
    const updateArg = {
      name: 'updateObj',
      type: 'object',
      description: `Properties of ${singularName} to update.`,
    };
    fnIndex.schema[`ensure${pluralTitle}Table`] = {
      args: [],
      description: `Ensures the ${pluralName} table is up to date.`,
    };
    fns[`ensure${pluralTitle}Table`] = connifyAndCommit(db, fns, `ensure${pluralTitle}Table`);
    fns[`ensure${pluralTitle}TableWithConn`] = async (conn, oldSchemaObj = {}) => {
      const { schema: oldSchema = {}, indices: oldIndices = {} } = oldSchemaObj;
      await Promise.all(
        Object.keys(schema).map(async (columnName) => {
          const columnType = schema[columnName];
          const oldColumnType = oldSchema[columnName];
          if (columnType !== oldColumnType) {
            if (!oldColumnType) {
              log.info(`"${columnName}" column was added to the "${tableName}" table.`);
              await conn.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
            } else {
              log.info(`"${columnName}" column was modified in the "${tableName}" table.`);
              await conn.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${columnType}`);
            }
          }
        })
      );
      await Promise.all(
        Object.keys(indices).map(async (hash) => {
          if (!oldIndices[hash]) {
            log.info(`Index "${hash}" was added to the "${tableName}" table.`);
            await conn.query(`
              CREATE ${indices[hash]}
            `);
          }
        })
      );
      await Promise.all(
        Object.keys(oldIndices).map(async (oldHash) => {
          if (!indices[oldHash]) {
            log.info(`Index "${oldHash}" was removed from the "${tableName}" table.`);
            try {
              await conn.query(`ALTER TABLE ${tableName} DROP INDEX ${oldHash}`);
            } catch (e) {}
          }
        })
      );
      await Promise.all(
        Object.keys(oldSchema).map(async (oldColumnName) => {
          const column = schema[oldColumnName];
          if (!column) {
            log.info(`"${oldColumnName}" column was removed from the "${tableName}" table.`);
            try {
              await conn.query(`ALTER TABLE ${tableName} DROP COLUMN ${oldColumnName}`);
            } catch (e) {}
          }
        })
      );
      await conn.query(`
        UPDATE ${metaTable} SET
          hash = ?, schema_obj = ?
        WHERE name = ?
      `, [tableHash, tableSchemaJson, tableName]);
    };
    fnIndex.schema[`forceUpdate${pluralTitle}MetaTable`] = {
      args: [],
      description: `Ensures the ${pluralName} metatable is up to date.`,
    };
    fns[`forceUpdate${pluralTitle}MetaTable`] = connifyAndCommit(db, fns, `forceUpdate${pluralTitle}MetaTable`);
    fns[`forceUpdate${pluralTitle}MetaTableWithConn`] = async (conn, oldSchemaObj = {}) => {
      await conn.query(`
        INSERT INTO ${metaTable}
          (name, hash, schema_obj)
        VALUES (?, ?, ?)
        ON DUPLICATE UPDATE
          hash = ?, schema_obj = ?
      `, [tableName, tableHash, tableSchemaJson, tableHash, tableSchemaJson]);
    };
    fnIndex.schema[`create${pluralTitle}Table`] = {
      args: [],
      description: `Creates the ${pluralName} table.`,
    };
    fns[`create${pluralTitle}Table`] = connifyAndCommit(db, fns, `create${pluralTitle}Table`);
    fns[`create${pluralTitle}TableWithConn`] = async (conn) => {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS ${tableName} (
          ${Object.keys(schema).map((columnName) => {
            return `${columnName} ${schema[columnName]}`;
          }).join(',')}
        )
      `);
      await Promise.all(
        Object.keys(indices).map(async (hash) => {
          await conn.query(`CREATE ${indices[hash]}`);
        })
      );
      await conn.query(`
        INSERT INTO ${metaTable}
          (name, hash, schema_obj)
        VALUES (?, ?, ?)
      `, [tableName, tableHash, tableSchemaJson]);
    };
    fnIndex.schema[`drop${pluralTitle}Table`] = {
      args: [],
      description: `Drops the ${pluralName} table.`,
    };
    fns[`drop${pluralTitle}Table`] = connifyAndCommit(db, fns, `drop${pluralTitle}Table`);
    fns[`drop${pluralTitle}TableWithConn`] = async (conn) => {
      await conn.query(`DROP TABLE IF EXISTS ${tableName}`);
      await conn.query(`DELETE FROM ${metaTable} WHERE name = ?`, [tableName]);
    };
    fnIndex.create[`create${singularTitle}`] = {
      args: [
        {
          name: 'createObj',
          type: 'object',
          description: `Properties for a new ${singularName}.`,
        },
      ],
      description: `Creates a new ${singularName}.`,
    };
    fns[`create${singularTitle}`] = connifyAndCommit(db, fns, `create${singularTitle}`);
    fns[`create${singularTitle}WithConn`] = async (conn, createObj) => {
      const columns = [];
      const params = [];
      Object.keys(fields).map(async (prop) => {
        const field = fields[prop];
        if (createObj[prop] === undefined && field.isRequired()) {
          throw new Error(`required_field_${prop}_missing`);
        }
      });
      await Promise.all(
        Object.keys(createObj).map(async (prop) => {
          const field = fields[prop];
          if (field) {
            const value = createObj[prop];
            const rowObj = await field.getRowObject(value, createObj);
            Object.keys(rowObj).forEach((column) => {
              columns.push(column);
              params.push(rowObj[column]);
            });
          }
        })
      );
      const result = await conn.query(`
        INSERT INTO ${tableName}
          (${columns.join(',')})
        VALUES
          (${columns.map(() => '?').join(',')})
      `, params);
      if (!result) return null;
      return result.insertId;
    };
    fnIndex.getter[`get${pluralTitle}`] = {
      args: [getListOptionsArg],
      description: `Gets all ${pluralName}.`,
    };
    fns[`get${pluralTitle}`] = connifyAndRelease(db, fns, `get${pluralTitle}`);
    fns[`get${pluralTitle}WithConn`] = async (conn, viewOptions = {}) => {
      const { viewFields, columnNames, where, params, sortColumns, limit, offset, map } = handleViewOptions(fields, viewOptions);
      const rows = await conn.query(`
        SELECT ${columnNames} FROM ${tableName}
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ${sortColumns.length > 0 ? `ORDER BY ${sortColumns.join(',')}` : ''}
        ${limit ? `LIMIT ${limit}` : ''}
        ${offset ? `OFFSET ${offset}` : ''}
      `, params);
      const objs = await Promise.all(
        rows.map(async (row) => {
          const obj = await getObjectFromRow(row, fields, viewFields, finalMap);
          if (typeof map === 'function') {
            return map(obj);
          }
          return obj;
        })
      );
      return objs;
    };
    fnIndex.getter[`get${singularTitle}ById`] = {
      args: [
        { name: 'id', type: 'string', description: `ID of the ${singularName} to fetch.` },
        getFieldsArg,
      ],
      description: `Gets ${singularName} with given ID.`,
    };
    fns[`get${singularTitle}ById`] = connifyAndRelease(db, fns, `get${singularTitle}ById`);
    fns[`get${singularTitle}ByIdWithConn`] = async (conn, id, viewFields = []) => {
      const columnNames = getColumnNamesForSelect(fields, viewFields);
      const rows = await conn.query(`
        SELECT ${columnNames} FROM ${tableName}
        WHERE id = ? LIMIT 1
      `, [id]);
      if (rows.length === 0) return null;
      return getObjectFromRow(rows[0], fields, viewFields, finalMap);
    };
    fnIndex.update[`update${singularTitle}ById`] = {
      args: [
        { name: 'id', type: 'string', description: `ID of the ${singularName} to update.` },
        updateArg,
      ],
      description: `Updates ${singularName} with given properties.`,
    };
    fns[`update${singularTitle}ById`] = connifyAndCommit(db, fns, `update${singularTitle}ById`);
    fns[`update${singularTitle}ByIdWithConn`] = async (conn, id, updateObj) => {
      const { setter, params } = await getSettersFromUpdateObj(updateObj, fields);
      params.push(id);
      await conn.query(`
        UPDATE ${tableName} SET
          ${setter.join(',')}
        WHERE id = ?
      `, params);
    };
    fnIndex.delete[`delete${singularTitle}ById`] = {
      args: [
        { name: 'id', type: 'string', description: `ID of the ${singularName} to delete.` },
      ],
      description: `Deletes ${singularName} with given ID.`,
    };
    fns[`delete${singularTitle}ById`] = connifyAndCommit(db, fns, `delete${singularTitle}ById`);
    fns[`delete${singularTitle}ByIdWithConn`] = async (conn, id) => {
      await conn.query(`
        DELETE FROM ${tableName}
        WHERE id = ? LIMIT 1
      `, [id]);
    };
    uniques.forEach((uniqueProps = []) => {
      const uniqueCodeNames = uniqueProps.map(prop => fields[prop].getCodeName()).join('');
      const uniqueNames = uniqueProps.map(prop => fields[prop].getReadableName()).join(', ');
      const uniqueArgs = uniqueProps.map(prop => fields[prop].getArgument());
      fnIndex.getter[`get${singularTitle}By${uniqueCodeNames}`] = {
        args: [...uniqueArgs, getFieldsArg],
        description: `Gets ${singularName} with corresponding ${uniqueNames}.`,
      };
      fns[`get${singularTitle}By${uniqueCodeNames}`] = connifyAndRelease(db, fns, `get${singularTitle}By${uniqueCodeNames}`);
      fns[`get${singularTitle}By${uniqueCodeNames}WithConn`] = async (conn, ...args) => {
        const uniqueValues = args.slice(0, uniqueArgs.length);
        const [viewFields = []] = args.slice(uniqueArgs.length);
        const columnNames = getColumnNamesForSelect(fields, viewFields);
        if (uniqueValues.length !== uniqueArgs.length) throw new Error('missing_arguments');
        const { where, params } = getWhereMatching(uniqueProps, uniqueValues, fields);
        const rows = await conn.query(`
          SELECT ${columnNames} FROM ${tableName}
          WHERE ${where.join(' AND ')} LIMIT 1
        `, params);
        if (rows.length === 0) return null;
        return getObjectFromRow(rows[0], fields, viewFields, finalMap);
      };
      fnIndex.update[`update${singularTitle}By${uniqueCodeNames}`] = {
        args: [...uniqueArgs, updateArg],
        description: `Updates ${singularName} with corresponding ${uniqueNames}.`,
      };
      fns[`update${singularTitle}By${uniqueCodeNames}`] = connifyAndCommit(db, fns, `update${singularTitle}By${uniqueCodeNames}`);
      fns[`update${singularTitle}By${uniqueCodeNames}WithConn`] = async (conn, ...args) => {
        const uniqueValues = args.slice(0, uniqueArgs.length);
        const [updateObj = {}] = args.slice(uniqueArgs.length);
        if (uniqueValues.length !== uniqueArgs.length) throw new Error('missing_arguments');
        const { setter, params } = await getSettersFromUpdateObj(updateObj, fields);
        const { where, params: additionalParams } = getWhereMatching(uniqueProps, uniqueValues, fields);
        params.push(...additionalParams);
        await conn.query(`
          UPDATE ${tableName} SET
            ${setter.join(',')}
          WHERE ${where.join(' AND ')}
        `, params);
      };
      fnIndex.delete[`delete${singularTitle}By${uniqueCodeNames}`] = {
        args: [...uniqueArgs],
        description: `Deletes ${singularName} with corresponding ${uniqueNames}.`,
      };
      fns[`delete${singularTitle}By${uniqueCodeNames}`] = connifyAndCommit(db, fns, `delete${singularTitle}By${uniqueCodeNames}`);
      fns[`delete${singularTitle}By${uniqueCodeNames}WithConn`] = async (conn, ...args) => {
        const uniqueValues = args.slice(0, uniqueArgs.length);
        if (uniqueValues.length !== uniqueArgs.length) throw new Error('missing_arguments');
        const { where, params } = getWhereMatching(uniqueProps, uniqueValues, fields);
        await conn.query(`
          DELETE FROM ${tableName}
          WHERE ${where.join(' AND ')} LIMIT 1
        `, params);
      };
    });
    queries.forEach(({ fields: queryProps = [], sort: sortProps = [] }) => {
      let queryCodeNames = '';
      let queryNames = [];
      const queryArgs = [];
      queryProps.forEach((prop, i) => {
        const slicedQueryProps = queryProps.slice(0, i + 1);
        const field = fields[prop];
        queryCodeNames = `${queryCodeNames}${field.getCodeName()}`;
        queryNames.push(field.getReadableName());
        const queryNamesStr = queryNames.join(', ');
        queryArgs.push(field.getArgument());
        fnIndex.getter[`get${pluralTitle}By${queryCodeNames}`] = {
          args: [...queryArgs, getListOptionsArg],
          description: `Gets ${pluralName} with ${queryNamesStr}.`,
        };
        fns[`get${pluralTitle}By${queryCodeNames}`] = connifyAndRelease(db, fns, `get${pluralTitle}By${queryCodeNames}`);
        fns[`get${pluralTitle}By${queryCodeNames}WithConn`] = async (conn, ...args) => {
          const queryValues = args.slice(0, slicedQueryProps.length);
          const [viewOptions = {}] = args.slice(slicedQueryProps.length);
          if (queryValues.length !== slicedQueryProps.length) throw new Error('missing_arguments');
          const argFilters = viewOptions.filters || [];
          const queryFilters = slicedQueryProps.map((prop, i) => ({ prop, op: '=', value: queryValues[i] }));
          viewOptions.filters = [...queryFilters, ...argFilters];
          return fns[`get${pluralTitle}WithConn`](conn, viewOptions);
        };
        fnIndex.update[`update${pluralTitle}By${queryCodeNames}`] = {
          args: [...queryArgs, updateArg],
          description: `Update all ${pluralName} with matching ${queryNamesStr}.`,
        };
        fns[`update${pluralTitle}By${queryCodeNames}`] = connifyAndCommit(db, fns, `update${pluralTitle}By${queryCodeNames}`);
        fns[`update${pluralTitle}By${queryCodeNames}WithConn`] = async (conn, ...args) => {
          const queryValues = args.slice(0, slicedQueryProps.length);
          const [updateObj = {}] = args.slice(slicedQueryProps.length);
          if (queryValues.length !== slicedQueryProps.length) throw new Error('missing_arguments');
          const { setter, params } = await getSettersFromUpdateObj(updateObj, fields);
          const { where, params: additionalParams } = getWhereMatching(slicedQueryProps, queryValues, fields);
          params.push(...additionalParams);
          await conn.query(`
            UPDATE ${tableName} SET
              ${setter.join(',')}
            WHERE ${where.join(' AND ')}
          `, params);
        };
        fnIndex.delete[`delete${pluralTitle}By${queryCodeNames}`] = {
          args: [...queryArgs],
          description: `Delete all ${pluralName} with matching ${queryNamesStr}.`,
        };
        fns[`delete${pluralTitle}By${queryCodeNames}`] = connifyAndCommit(db, fns, `delete${pluralTitle}By${queryCodeNames}`);
        fns[`delete${pluralTitle}By${queryCodeNames}WithConn`] = async (conn, ...args) => {
          const queryValues = args.slice(0, slicedQueryProps.length);
          if (queryValues.length !== slicedQueryProps.length) throw new Error('missing_arguments');
          const { where, params } = getWhereMatching(slicedQueryProps, queryValues, fields);
          await conn.query(`
            DELETE FROM ${tableName}
            WHERE ${where.join(' AND ')}
          `, params);
        };
      });
    });
    models[singularTitle] = {
      names,
      fields,
      schema,
      indices,
      tableHash,
    };
  });
  fnIndex.schema['dropAllTables'] = {
    args: [],
    description: `Drop all tables, and the meta table from the DB.`,
  };
  fns.dropAllTables = connifyAndCommit(db, fns, 'dropAllTables');
  fns.dropAllTablesWithConn = async (conn) => {
    log.info(`DROPPING ALL TABLES!`);
    for (let i = 0; i < models.length; i++) {
      const { tableName, pluralTitle } = models[i];
      log.info(`Drop table "${tableName}"...`);
      await fns[`drop${pluralTitle}Table`]();
    }
    await conn.query(`
      DROP TABLE IF EXISTS ${metaTable}
    `);
  };
  fnIndex.schema['forceUpdateAllMetaTables'] = {
    args: [],
    description: `Update the meta table to reflect the new schema.`,
  };
  fns.forceUpdateAllMetaTables = connifyAndCommit(db, fns, 'forceUpdateAllMetaTables');
  fns.forceUpdateAllMetaTablesWithConn = async (conn) => {
    for (let i = 0; i < models.length; i++) {
      const { pluralTitle } = models[i];
      await fns[`forceUpdate${pluralTitle}MetaTable`]();
    }
  };
  fnIndex.schema['ensureAllTables'] = {
    args: [],
    description: `Create or update the tables in the DB.`,
  };
  fns.ensureAllTables = connifyAndCommit(db, fns, 'ensureAllTables');
  fns.ensureAllTablesWithConn = async (conn) => {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS ${metaTable} (
        name VARCHAR(31) PRIMARY KEY,
        hash VARCHAR(127),
        schema_obj TEXT
      )
    `);
    const keys = Object.keys(models);
    for (let i = 0; i < keys.length; i++) {
      const singularTitle = keys[i];
      const { names, tableHash } = models[singularTitle];
      const { pluralTitle, tableName } = names;
      const hashRows = await conn.query(`
        SELECT hash, schema_obj FROM ${metaTable} WHERE name = ? LIMIT 1
      `, [tableName]);
      const [hashRow] = hashRows || [];
      const {
        hash: oldHash = '',
        schema_obj: oldSchemaJson = '',
      } = hashRow || {};
      if (!oldHash) {
        log.info(`First time seeing this schema, create "${tableName}" table!`);
        await fns[`create${pluralTitle}Table`]();
      } else if (oldHash !== tableHash) {
        log.info(`"${tableName}" table changed - updating schema.`);
        const oldSchemaObj = JSON.parse(oldSchemaJson);
        await fns[`ensure${pluralTitle}Table`](oldSchemaObj);
      } else {
        log.info(`No schema changes for "${tableName}".`);
      }
    }
  };
  return { index: fnIndex, fns, models };
};
