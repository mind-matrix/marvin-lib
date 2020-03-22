var isBrowser=new Function("try {return this===window;}catch(e){ return false;}");

const esprima = require('esprima');
const FastMap = require('collections/fast-map');
const uniqid = require('uniqid');
let comparse, fs, WebSocket, rtc;
if(isBrowser()) {
  comparse = require('comment-parser/parser.js');
  WebSocket = window.WebSocket;
  fs = null;
  window.uniqid = uniqid;
} else {
  fs = require('fs');
  WebSocket = require('ws');
  comparse = require('comment-parser');
  rtc = require('rtc-everywhere')();
}

const configuration = {
  'iceServers': [
    {'urls': 'stun:stun.l.google.com:19302'},
    {'urls': 'stun:23.21.150.121:3478'},
    {'urls': 'stun:s1.taraba.net:3478'}
  ]
};

const SCOPE = {
  PUBLIC: 0,
  PRIVATE: 1
};

class IsomorphicWebSocket extends WebSocket {
  constructor (url) {
    super(url);
    this.listeners = {
      open: [],
      message: [],
      close: []
    };
    this.onopen = () => {
      this.listeners.open.forEach((cb) => cb());
    };
    this.onmessage = (e) => {
      this.listeners.message.forEach((cb) => cb(e.data));
    };
    this.onclose = () => {
      this.listeners.close.forEach((cb) => cb());
    };
  }
  on(tag, callback) {
    if(tag === 'open' && this.readyState === this.OPEN)
      callback();
    else if(tag === 'close' && this.readyState === this.readyState === this.CLOSED)
      callback();
    else if(this.listeners.hasOwnProperty(tag))
      this.listeners[tag].push(callback);
  }
}

function createWebSocket(url) {
  if(isBrowser())
    return new IsomorphicWebSocket(url);
  else
    return new WebSocket(url);
}

function createRTCPeerConnection(configuration) {
  if(isBrowser())
    return new RTCPeerConnection(configuration);
  else
    return new rtc.RTCPeerConnection(configuration);
}

function createRTCSessionDescription(desc) {
  if(isBrowser())
    return new RTCSessionDescription(desc);
  else
    return new rtc.RTCSessionDescription(desc);
}

class Service {

  static get SCOPE() {
    return SCOPE;
  }

  constructor (id, { key, keyFile }) {
    if(!key) {
      if(keyFile) {
        if(!fs)
          throw new Error('Cannot use keyFile in Browser.');
        else
          key = fs.readFileSync(keyFile, { encoding: 'utf-8' });
      } else {
        throw new Error('Either provide a key or a keyFile');
      }
    }
    this.socket = createWebSocket(`wss://marvin-server.herokuapp.com`);
    this.token = key;
    this.identifier = id;
    this.socket.on('open', () => {
      this.Send({
        action: 'activate'
      });
    });
    this.connections = new FastMap();
    this.socket.on('message', async (msg) => {
      var { clientId, message } = JSON.parse(msg);
      if(message.request === 'offer') {
        const peerConnection = createRTCPeerConnection(configuration);
        this.connections.set(clientId, {
          peerConnection,
          dataChannel: null
        });
        await peerConnection.setRemoteDescription(createRTCSessionDescription(message.data));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        this.Send({
          action: 'message',
          clientId: clientId,
          message: {
            response: 'answer',
            data: answer
          }
        });
        peerConnection.addEventListener('icecandidate', event => {
            if (event.candidate) {
              this.Send({
                action: 'message',
                clientId: clientId,
                message: {
                  response: 'exchange-ice-candidate',
                  data: event.candidate
                }
              });
            }
        });
        peerConnection.addEventListener('datachannel', event => {
          const dataChannel = event.channel;
          this.connections.get(clientId).dataChannel = dataChannel;
          dataChannel.addEventListener('message', async event => {
            const data = JSON.parse(event.data);
            if(data.request === 'execute') {
              var result = await this.container[data.procedure](...data.params);
              dataChannel.send(
                JSON.stringify({
                  response: 'result',
                  data: {
                    result,
                    id: data.id
                  }
                })
              );
            }
          });
        });
      } else if(message.request === 'exchange-ice-candidate') {
        var peerConnection = this.connections.get(clientId).peerConnection;
        await peerConnection.addIceCandidate(message.data);
      } else if(message.request === 'execute') {
        var result = await this.container[message.data.procedure](...message.data.params);
        this.Send({
          action: 'message',
          clientId: clientId,
          message: {
            response: 'result',
            data: {
              result: result,
              id: message.data.id
            }
          }
        });
      }
    });
  }

  close() {
    this.Send({
      action: 'deactivate'
    });
  }

  register(containerClass) {
    this.procedures = [];
    let parsed = esprima.parse(containerClass.toString(), { attachComment: true });
    let classDec = parsed.body[0];
    if(classDec.type === 'ClassDeclaration') {
      this.container = new containerClass();
      let classBody = classDec.body;
      classBody.body.forEach((method, index) => {
        if(method.kind === 'method') {
          let commentBlock = method.leadingComments.find(v => v.type === 'Block').value;
          let procedure = {
            name: method.key.name
          };
          if(commentBlock) {
            let comment = comparse(`/*${commentBlock}*/`)[0];
            procedure['description'] = comment.description;
            let args = comment.tags.filter(v => v.tag === 'param').map(v => ({
              name: v.name,
              type: v.type,
              optional: v.optional,
              default: v.default,
              description: v.description
            }));
            if(args.length > 0) {
              procedure['arguments'] = args;
            }
            let returns = comment.tags.filter(v => v.tag === 'returns').map(v => ({
              type: v.type,
              description: v.name + ' ' + v.description
            }));
            if(returns.length > 0) {
              procedure['returns'] = returns[0];
            }
          }
          this.procedures.push(procedure);
        }
      });
      this.socket.on('open', () => {
        this.Send({
          action: 'update-procedures',
          procedures: this.procedures
        });
      });
    } else {
      throw new Error('Provided container is not an ES6 class');
    }
  }

  Send(object) {
    var payload = {
      data: object
    };
    if(this.token)
      payload['token'] = this.token;
    this.socket.send(JSON.stringify(payload));
  }
}

class ServiceConnection {

  static get SCOPE() {
    return SCOPE;
  }

  constructor (id, scope = SCOPE.PUBLIC, key) {
    if(scope === SCOPE.PRIVATE && !key) {
      throw new Error('Private Services require a valid API Key');
    }
    this.id = id;
    this.key = key;
    this.scope = scope;
    this._socket = createWebSocket(`wss://marvin-server.herokuapp.com`);
    this._listener = {
      'socket-transport': [],
      'rtc-transport': [],
      'rtc-close': [],
      'socket-close': []
    };
    this._socket.on('close', () => {
      this._listener["socket-close"].forEach((callback) => {
        callback();
      });
    });
    this._connection = createRTCPeerConnection(configuration);
    this._connection.addEventListener('icecandidate', (event) => {
      if(event.candidate) {
        this._Send({
          response: 'exchange-ice-candidate',
          data: event.candidate
        });
      }
    });
    this._socket.on("message", (msg) => {
      let { message } = JSON.parse(msg);
      let { response, data } = message;
      if(response === 'exchange-ice-candidate') {
        this._connection.addIceCandidate(data);
      }
    });
    this._connection.addEventListener('connectionstatechanged', event => {
      if (this._connection.connectionState === 'connected') {
        this._dataChannel = this._connection.createDataChannel('primary');
        this._dataChannel.addEventListener('open', event => {
          this._listener["rtc-transport"].forEach((callback) => {
            callback(this);
          });
        });
        this._dataChannel.addEventListener('close', event => {
          this._listener["rtc-close"].forEach((callback) => {
            callback();
          });
        });
      }
    });
    this._isNegotiating = false;
    this._connection.onnegotiationneeded = async (e) => {
      if(this._isNegotiating)
        return;
      await this.negotiate();
    };
    this.negotiate();
    this._connection.onsignalingstatechange = (e) => {
      this._isNegotiating = (this._connection.signalingState != "stable");
    };
  }

  async negotiate() {
    this._isNegotiating = true;
    return new Promise(async (resolve, reject) => {
      const offer = await this._connection.createOffer();
      await this._connection.setLocalDescription(offer);
      this._socket.on('message', async (msg) => {
        let { message } = JSON.parse(msg);
        let { response, data, procedures } = message;
        if(response === 'answer' && procedures) {
          for(const procedure of procedures) {
            this[procedure.name] = new Function(`
              return function (${ procedure.arguments.map(v => v.optional ? v.name + '=' + (typeof v.default === 'string' ? `'${v.default}'`: v.default) : v.name).join(",") }) {
                var execMessage = {
                  request: 'execute',
                  data: {
                    procedure: "${ procedure.name }",
                    params: [ ${ procedure.arguments.map(v => v.name).join(",") } ],
                    id: uniqid()
                  }
                };
                return new Promise((resolve, reject) => {
                  if(this._dataChannel) {
                    this._dataChannel.addEventListener("message", event => {
                      var message = JSON.parse(event.data)
                      if(message.response === "result" && message.data.id === execMessage.data.id)
                        resolve(message.data.result);
                    });
                    this._dataChannel.send(
                      JSON.stringify(execMessage)
                    );
                  } else {
                    console.log('WebRTC Transport not yet available. Routing via. Socket Server');
                    this._socket.on("message", (msg) => {
                      let { message } = JSON.parse(msg);
                      let { response, data } = message;
                      if(response === "result" && data.id === execMessage.data.id)
                        resolve(data.result);
                    });
                    this._Send(execMessage);
                  }
                });
              }
            `)();
          }
          this._listener["socket-transport"].forEach((callback) => {
            callback(this);
          });
          const remoteDesc = createRTCSessionDescription(data);
          await this._connection.setRemoteDescription(remoteDesc);
        }
        resolve();
      });
      this._socket.on('open', () => {
        this._Send({
          request: 'offer',
          data: offer
        });
      });
    });
  }

  on(tag, callback) {
    if(tag === 'rtc-transport') {
      if(this._dataChannel) {
      callback(this);
      } else {
        this._listener["rtc-transport"].push(callback);
      }
    } else if(tag === 'socket-transport') {
      if(this._socket.readyState === WebSocket.OPEN) {
        callback(this);
      } else {
        this._listener["socket-transport"].push(callback);
      }
    } else if(tag === 'socket-close') {
      if(this._socket.readyState === WebSocket.CLOSED) {
        callback();
      } else {
        this._listener["socket-close"].push(callback);
      }
    } else if(tag === 'rtc-close') {
      if(this._dataChannel.readyState === "closed") {
        callback();
      } else {
        this._listener["rtc-close"].push(callback);
      }
    }
  }

  _Send(message) {
    if(this.scope === SCOPE.PUBLIC) {
      this._socket.send(
        JSON.stringify({
          serviceId: this.id,
          data: {
            message
          }
        })
      );
    } else {
      this._socket.send(
        JSON.stringify({
          serviceId: this.id,
          data: {
            key: this.key,
            message
          }
        })
      );
    }
  }
}

if(isBrowser()) {
  window.Service = Service;
  window.ServiceConnection = ServiceConnection;
} else {
  module.exports = {
    Service,
    ServiceConnection
  };
}