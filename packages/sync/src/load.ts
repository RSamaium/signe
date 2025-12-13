import { isSignal } from "@signe/reactive";
import { DELETE_TOKEN, setMetadata } from "./core";
import { isClass } from "./utils";

/**
 * Loads values into the root instance by paths or from an object.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, either as paths or an object.
 * @param {boolean} [valueIsObject=false] - If true, `values` is treated as an object.
 * @example
 * // Using paths:
 * load(instance, { 'position.x': 10, 'position.y': 20 });
 * 
 * // Using an object:
 * load(instance, { position: { x: 10, y: 20 } }, true);
 */
export function load(rootInstance: any, values: { [path: string]: any }): void;
export function load(
  rootInstance: any,
  values: object,
  valueIsObject: true
): void;
export function load(
  rootInstance: any,
  values: { [path: string]: any } | object,
  valueIsObject?: boolean
) {
  if (valueIsObject) {
    loadFromObject(rootInstance, values);
  } else {
    loadFromPaths(rootInstance, values);
  }
}

/**
 * Loads values into the root instance using paths.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load, with keys as paths.
 * @example
 * loadFromPaths(instance, { 'position.x': 10, 'position.y': 20 });
 */
function loadFromPaths(rootInstance: any, values: { [path: string]: any }) {
  // Check if any value is an object - if so, treat as nested object structure
  const hasNestedObjects = Object.values(values).some(
    v => typeof v === "object" && !Array.isArray(v) && v !== null
  );
  
  if (hasNestedObjects) {
    // Convert to object format and use loadFromObject
    loadFromObject(rootInstance, values);
    return;
  }
  
  // First pass: collect data for class instances that need to be created
  const instanceDataMap = new Map<string, any>();
  
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    
    // Check if this path might create a class instance
    // We need to check each intermediate path to see if it's a class collection
    for (let i = 1; i < parts.length; i++) {
      const instancePath = parts.slice(0, i).join(".");
      const instanceId = parts[i];
      const remainingPath = parts.slice(i + 1).join(".");
      
      // Get the parent signal
      const parentInstance = getByPath(rootInstance, instancePath);
      const classType = parentInstance?.options?.classType;
      
      if (classType && isClass(classType) && remainingPath) {
        // This is a class instance path, collect the data
        const fullInstancePath = `${instancePath}.${instanceId}`;
        if (!instanceDataMap.has(fullInstancePath)) {
          instanceDataMap.set(fullInstancePath, {});
        }
        const instanceData = instanceDataMap.get(fullInstancePath);
        
        // Store the value in the nested structure
        const nestedParts = remainingPath.split(".");
        let current = instanceData;
        for (let j = 0; j < nestedParts.length - 1; j++) {
          if (!current[nestedParts[j]]) {
            current[nestedParts[j]] = {};
          }
          current = current[nestedParts[j]];
        }
        current[nestedParts[nestedParts.length - 1]] = value;
      }
    }
  }
  
  // Create instances with collected data before loading values
  for (const [instancePath, instanceData] of instanceDataMap.entries()) {
    const parts = instancePath.split(".");
    const instanceId = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join(".");
    
    const parentInstance = getByPath(rootInstance, parentPath);
    const classType = parentInstance?.options?.classType;
    
    if (classType && isClass(classType)) {
      let parentContainer = rootInstance;
      if (parentPath) {
        const parentParts = parentPath.split(".");
        for (const part of parentParts) {
          if (isSignal(parentContainer)) {
            parentContainer = parentContainer();
          }
          parentContainer = parentContainer[part];
        }
      }
      
      if (isSignal(parentContainer)) {
        const container = parentContainer();
        if (!container[instanceId]) {
          // Create instance with collected data
          container[instanceId] = new classType(instanceData);
          setMetadata(container[instanceId], 'id', instanceId);
          parentContainer.set({ ...container });
        }
      }
    }
  }
  
  // Second pass: load all values
  for (const [path, value] of Object.entries(values)) {
    const parts = path.split(".");
    loadValue(rootInstance, parts, value);
  }
}

/**
 * Recursively loads values from an object into the root instance.
 * 
 * @param {object} rootInstance - The instance into which values will be loaded.
 * @param {object} values - The values to load.
 * @param {string} [currentPath=""] - The current path in the recursion.
 * @example
 * loadFromObject(instance, { position: { x: 10, y: 20 } });
 */
function loadFromObject(
  rootInstance: any,
  values: object,
  currentPath: string = ""
) {
  for (let key in values) {
    const value = values[key];
    const newPath = currentPath ? `${currentPath}.${key}` : key;
    
    // Check if this object should be created as a class instance
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      // Get the signal for the current path (parent of the key we're processing)
      let parentSignal: any = rootInstance;
      
      if (currentPath) {
        const parentParts = currentPath.split(".");
        for (const part of parentParts) {
          if (isSignal(parentSignal)) {
            parentSignal = parentSignal();
          }
          parentSignal = parentSignal[part];
        }
      }
      
      // Get the signal for the current key
      let currentSignal = parentSignal;
      if (isSignal(currentSignal)) {
        currentSignal = currentSignal();
      }
      currentSignal = currentSignal?.[key];
      
      // Check if current key points to a signal with classType
      // We need to get the signal itself, not its value
      let signalForClassType: any = rootInstance;
      if (currentPath) {
        const parentParts = currentPath.split(".");
        for (const part of parentParts) {
          if (isSignal(signalForClassType)) {
            signalForClassType = signalForClassType();
          }
          signalForClassType = signalForClassType[part];
        }
      }
      signalForClassType = signalForClassType?.[key];
      
      const classType = isSignal(signalForClassType) ? signalForClassType.options?.classType : undefined;
      
      // If this is a class type collection, create instances with data
      if (classType && isClass(classType)) {
        const container = isSignal(signalForClassType) ? signalForClassType() : {};
        
        // For each key in the value object, create a class instance
        for (const instanceId in value) {
          const instanceData = value[instanceId];
          if (typeof instanceData === "object" && !Array.isArray(instanceData) && instanceData !== null) {
            if (!container[instanceId]) {
              // Create instance with initial data
              container[instanceId] = new classType(instanceData);
              setMetadata(container[instanceId], 'id', instanceId);
              // Load data into the instance properties
              load(container[instanceId], instanceData, true);
            } else {
              // Instance already exists, load data directly into it
              load(container[instanceId], instanceData, true);
            }
          }
        }
        
        if (isSignal(signalForClassType)) {
          signalForClassType.set({ ...container });
        }
      } else {
        // Continue recursion for nested objects
        loadFromObject(rootInstance, value, newPath);
      }
    } else {
      const parts = newPath.split(".");
      loadValue(rootInstance, parts, value);
    }
  }
}

/**
 * Sets a value in the root instance by navigating through the path parts.
 * 
 * @param {object} rootInstance - The instance into which the value will be set.
 * @param {string[]} parts - The parts of the path.
 * @param {any} value - The value to set.
 * @example
 * loadValue(instance, ['position', 'x'], 10);
 */
function loadValue(rootInstance: any, parts: string[], value: any) {
  let current: any = rootInstance;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (i === parts.length - 1) {
      if (value == DELETE_TOKEN) {
        if (isSignal(current)) {
          current = current();
        }
        Reflect.deleteProperty(current, part);
      }
      else if (current[part]?._subject) {
        current[part].set(value);
      }
      else if (isSignal(current) && Array.isArray(current()) && !isNaN(Number(part))) {
        current()[Number(part)] = value;
      }
      else {
        current[part] = value;
      }
    } else {
      if (isSignal(current)) {
        current = current();
      }
      const currentValue = current[part];
      if (currentValue === undefined) {
        const parentInstance = getByPath(
          rootInstance,
          parts.slice(0, i).join(".")
        );
        const classType = parentInstance?.options?.classType;
        if (classType) {
          // Create instance with empty object as initial data
          // (instances with data should have been created in loadFromPaths)
          current[part] = !isClass(classType) ? classType(part) : new classType({});
          setMetadata(current[part], 'id', part)
        } else {
          current[part] = {};
        }
      }
      current = current[part];
    }
  }
}

/**
 * Retrieves a value from the root instance by a path.
 * 
 * @param {object} root - The root instance.
 * @param {string} path - The path to the value.
 * @returns {any} - The value at the specified path.
 * @example
 * const value = getByPath(instance, 'position.x');
 */
export function getByPath(root: any, path: string) {
  const parts = path.split(".");
  let current = root;
  for (const part of parts) {
    if (isSignal(current)) {
      current = current();
    }
    if (current[part]) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}
