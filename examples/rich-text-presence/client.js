var ReconnectingWebSocket = require('reconnecting-websocket');
var sharedb = require('sharedb/lib/client');
var richText = require('./rich-text');
var Quill = require('quill');
var QuillCursors = require('quill-cursors');
var tinycolor = require('tinycolor2');

sharedb.types.register(richText.type);
Quill.register('modules/cursors', QuillCursors);

var clients = [];
var colors = {};

var collection = 'examples';
var id = 'richtext';

var editorContainer = document.querySelector('.editor-container');
document.querySelector('#add-client').addEventListener('click', function() {
  addClient();
});

addClient();
addClient();

function addClient() {
  var socket = new ReconnectingWebSocket('ws://' + window.location.host);
  var connection = new sharedb.Connection(socket);
  var doc = connection.get(collection, id);
  doc.subscribe(function(err) {
    if (err) throw err;
    var quill = initialiseQuill(doc);
    var color = '#' + tinycolor.random().toHex();
    var id = 'client-' + (clients.length + 1);
    colors[id] = color;

    clients.push({
      quill: quill,
      doc: doc,
      color: color
    });

    document.querySelector('#' + id + ' h1').style.color = color;
  });
}

function initialiseQuill(doc) {
  var quill = new Quill(quillContainer(), {
    theme: 'bubble',
    modules: {
      cursors: true
    }
  });
  var cursors = quill.getModule('cursors');
  var index = clients.length;

  quill.setContents(doc.data);

  quill.on('text-change', function(delta, oldDelta, source) {
    if (source !== 'user') return;
    doc.submitOp(delta);
  });

  doc.on('op', function(op, source) {
    if (source) return;
    quill.updateContents(op);
  });

  var presence = doc.connection.getDocPresence(collection, id);
  presence.subscribe(function(error) {
    if (error) throw error;
  });
  var localPresence = presence.create('client-' + (index + 1));

  quill.on('selection-change', function(range) {
    // Ignore blurring, so that we can see lots of users in the
    // same window
    if (!range) return;
    localPresence.submit(range, function(error) {
      if (error) throw error;
    });
  });

  presence.on('receive', function(id, range) {
    cursors.createCursor(id, id, colors[id]);
    cursors.moveCursor(id, range);
  });

  return quill;
}

function quillContainer() {
  var wrapper = document.createElement('div');
  wrapper.classList.add('editor');
  var index = clients.length;
  wrapper.id = 'client-' + (index + 1);

  wrapper.innerHTML =
    '  <h1>Client' + (index + 1) + '</h1>' +
    '  <button class="remove-client">Remove</button>' +
    '  <button class="client-connection connected">Disconnect</button>' +
    '  <div class="quill"></div>';

  wrapper.querySelector('.remove-client').addEventListener('click', function() {
    removeClient(clients[index]);
  });

  var connectionButton = wrapper.querySelector('.client-connection');
  connectionButton.addEventListener('click', function() {
    toggleConnection(connectionButton, clients[index]);
  });

  editorContainer.appendChild(wrapper);
  return wrapper.querySelector('.quill');
}

function toggleConnection(button, client) {
  if (button.classList.contains('connected')) {
    button.classList.remove('connected');
    button.textContent = 'Connect';
    disconnectClient(client);
  } else {
    button.classList.add('connected');
    button.textContent = 'Disconnect';
    connectClient(client);
  }
}

function disconnectClient(client) {
  client.doc.connection.close();
}

function connectClient(client) {
  var socket = new ReconnectingWebSocket('ws://' + window.location.host);
  client.doc.connection.bindToSocket(socket);
}

function removeClient(client) {
  client.quill.root.parentElement.parentElement.remove();
  client.doc.destroy(function(error) {
    if (error) throw error;
  });
}
