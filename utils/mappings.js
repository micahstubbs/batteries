import mappingUsecase from './mappingUsecase';
import analyzerSettings from './analyzerSettings';
import { SCALR_API, ACC_API } from './index';

const PRESERVED_KEYS = ['meta'];
export const REMOVED_KEYS = ['~logs', '~percolator', '.logs', '.percolator', '_default_'];

function getAuthHeaders(credentials) {
	if (credentials) {
		return {
			Authorization: `Basic ${btoa(credentials)}`,
		};
	}
	return {};
}

export function getMappings(appName, credentials, url = SCALR_API) {
	return new Promise((resolve, reject) => {
		fetch(`${url}/${appName}/_mapping`, {
			method: 'GET',
			headers: {
				...getAuthHeaders(credentials),
				'Content-Type': 'application/json',
			},
		})
			.then(res => res.json())
			.then((data) => {
				const types = Object.keys(data[appName].mappings).filter(type => !REMOVED_KEYS.includes(type));

				let mappings = {};
				types.forEach((type) => {
					mappings = {
						...mappings,
						[type]: data[appName].mappings[type],
					};
				});
				resolve(mappings);
			})
			.catch((e) => {
				reject(e);
			});
	});
}

export function reIndex(mappings, appId, excludeFields) {
	const body = {
		mappings,
		settings: analyzerSettings,
		exclude_fields: excludeFields,
		es_version: '5',
	};
	return new Promise((resolve, reject) => {
		fetch(`${ACC_API}/app/${appId}/reindex`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		})
			.then(res => res.json())
			.then((data) => {
				if (data.error) {
					reject(data.error);
				}
				if (data.body && data.body.response_info.failures.length) {
					reject(data.body.response_info.failures);
				}
				if (data.message !== 'App has been successfully reindexed.') {
					reject(data.message);
				}
				resolve(data.body.response_info.took);
			})
			.catch((e) => {
				reject(e);
			});
	});
}

export function hasAggs(field) {
	if (!field) return false;

	let hasAggsFlag = false;
	Object.keys(field).forEach((subField) => {
		if (
			field[subField].type === 'keyword' ||
			(field[subField].type === 'string' && field[subField].index === 'not_analyzed') // for ES2
		) {
			hasAggsFlag = true;
		}
	});
	return hasAggsFlag;
}

export function transformToES5(mapping) {
	// eslint-disable-next-line
	let _mapping = { ...mapping };

	Object.keys(_mapping).every((key) => {
		if (PRESERVED_KEYS.includes(key)) return false;

		if (_mapping[key].type === 'string') {
			const hasUsecase = !!_mapping[key].fields;
			let usecase = { ..._mapping[key] };

			if (hasUsecase) {
				if (_mapping[key].fields.search) {
					usecase = mappingUsecase.search;
				} else if (hasAggs(_mapping[key].field)) {
					usecase = mappingUsecase.aggs;
				}
			}

			_mapping = {
				..._mapping,
				[key]: {
					...usecase,
					type: 'text',
				},
			};
		} else if (typeof _mapping[key] === 'object' && !Array.isArray(_mapping[key])) {
			_mapping = {
				..._mapping,
				[key]: {
					..._mapping[key],
					...transformToES5(_mapping[key]),
				},
			};
		}
		return true;
	});
	return _mapping;
}

export function updateMapping(mapping, field, type, usecase) {
	// eslint-disable-next-line
	let _mapping = { ...mapping };

	Object.keys(_mapping).every((key) => {
		if (PRESERVED_KEYS.includes(key)) return false;

		if (key === field) {
			let newUsecase = {};
			if (usecase) {
				newUsecase = mappingUsecase[usecase];
			}
			_mapping = {
				..._mapping,
				[key]: {
					...newUsecase,
					type,
				},
			};
		} else if (typeof _mapping[key] === 'object' && !Array.isArray(_mapping[key])) {
			_mapping = {
				..._mapping,
				[key]: {
					..._mapping[key],
					...updateMapping(_mapping[key], field, type, usecase),
				},
			};
		}
		return true;
	});
	return _mapping;
}

/**
 * Traverse the mappings object & returns the fields (leaf)
 * @param {Object} mappings
 * @returns {{ [key: string]: Array<string> }}
 */
export function traverseMapping(mappings = {}, returnOnlyLeafFields = false) {
	const fieldObject = {};
	const checkIfPropertyPresent = (m, type) => {
		fieldObject[type] = [];
		const setFields = (mp, prefix = '') => {
			if (mp.properties) {
				Object.keys(mp.properties).forEach((mpp) => {
					if (!returnOnlyLeafFields) {
						fieldObject[type].push(`${prefix}${mpp}`);
					}
					const field = mp.properties[mpp];
					if (field && field.properties) {
						setFields(field, `${prefix}${mpp}.`);
					} else if (returnOnlyLeafFields) {
						// To return only leaf fields
						fieldObject[type].push(`${prefix}${mpp}`);
					}
				});
			}
		};
		setFields(m);
	};
	Object.keys(mappings).forEach(k => checkIfPropertyPresent(mappings[k], k));
	return fieldObject;
}

function getFieldsTree(mappings = {}, prefix = null) {
	let tree = {};
	Object.keys(mappings).forEach((key) => {
		if (mappings[key].properties) {
			tree = {
				...tree,
				...getFieldsTree(mappings[key].properties, key),
			};
		} else {
			const originalFields = mappings[key].fields;
			tree = {
				...tree,
				[`${prefix ? `${prefix}.` : ''}${key}`]: {
					type: mappings[key].type,
					fields: mappings[key].fields ? Object.keys(mappings[key].fields) : [],
					originalFields: originalFields || {},
				},
			};
		}
	});

	return tree;
}

/**
 * returns field types with sub-fields
 * @param {Object} mappings
 * @param {String} prefix
 */
export function getMappingsTree(mappings = {}) {
	let tree = {};
	Object.keys(mappings).forEach((key) => {
		if (mappings[key].properties) {
			tree = {
				...tree,
				...getFieldsTree(mappings[key].properties, null),
			};
		}
	});

	return tree;
}
