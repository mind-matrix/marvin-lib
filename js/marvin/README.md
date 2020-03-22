# Marvin
Javascript Service and ServiceConnection implementations for Marvin.

## Installation
### NodeJS and Webpack
Install using npm:

```sh
npm install --save @mindmatrix/marvin
```

First require the service and service connection classes as follows:

```js
const { Service, ServiceConnection } = require('@mindmatrix/marvin');
```

Then to register a service, first create a Service instance and then call the register function with the service class as argument.

```js
var myservice = new Service('@me/my-service-id', { key: 'my-key' });
myservice.register(MyService);
```

In NodeJS, you can also pass a file that contains the key instead of the key string:

```js
var myservice = new Service('@me/my-service-id', { keyFile: 'path-to-key-file' });
myservice.register(MyService);
```

### Javascript
Include the script in the dist folder into your .html file:

```html
<script src="dist/marvin.min.js"></script>
```

The Service and Service classes are available to you after that. Rest of the procedure for creating a service, registering a class and/or creating a service connection are similar to the NodeJS/Webpack version.

*Note:* In both the Webpack and the Javascript distributions, you cannot use the keyFile parameter. Doing so will throw an error. Use the key string instead.