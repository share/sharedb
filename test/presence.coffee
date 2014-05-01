assert = require 'assert'

{createClient, createDoc, setup, teardown} = require './util'

# This isn't working at the moment - we regressed.
describe.skip 'presence', ->
  beforeEach setup

  afterEach teardown

  describe 'fetch and set', ->
    it 'fetchPresence on a doc with no presence data returns {}', (done) ->
      @client.fetchPresence @cName, @docName, (err, presence) ->
        throw new Error err if err
        assert.deepEqual presence, {}
        done()

    it 'subscribe returns empty presence data for an empty doc', (done) ->
      @client.subscribe @cName, @docName, 0, wantPresence:yes, (err, stream, presence) =>
        throw new Error err if err
        assert.deepEqual presence, {}
        done()

    it 'lets you set presence data for the whole document', (done) ->
      @client.submitPresence @cName, @docName, {v:0, val:{id:{name:'seph'}}}, (err) =>
        throw new Error err if err
        @client.fetchPresence @cName, @docName, (err, presence) ->
          assert.deepEqual presence, {id:{name:'seph'}}
          done()

    it "lets you set a user's presence data", (done) ->
      @client.submitPresence @cName, @docName, {v:0, p:['id'], val:{name:'seph'}}, (err) =>
        throw new Error err if err
        @client.fetchPresence @cName, @docName, (err, presence) ->
          assert.deepEqual presence, {id:{name:'seph'}}
          done()

    it 'lets you set a field', (done) -> @create =>
      @client.submitPresence @cName, @docName, {v:1, p:['id', 'name'], val:'ian'}, (err) =>
        throw new Error err if err
        @client.fetchPresence @cName, @docName, (err, presence) ->
          assert.deepEqual presence, {id:{name:'ian'}}
          done()

    it 'lets you edit without a version specified', (done) -> @create =>
      @client.submitPresence @cName, @docName, {p:['id', 'name'], val:'ian'}, (err) =>
        throw new Error err if err
        @client.fetchPresence @cName, @docName, (err, presence) ->
          assert.deepEqual presence, {id:{name:'ian'}}
          done()

    it 'lets you change a field', (done) ->
      @client.submitPresence @cName, @docName, {v:0, p:['id'], val:{name:'seph'}}, (err) =>
        throw new Error err if err
        @client.submitPresence @cName, @docName, {v:0, p:['id', 'name'], val:'nate'}, (err) =>
          throw new Error err if err
          @client.fetchPresence @cName, @docName, (err, presence) ->
            assert.deepEqual presence, {id:{name:'nate'}}
            done()

    it 'does not let you set reserved (underscored) values other than cursor', (done) ->
      @client.submitPresence @cName, @docName, {v:0, p:['id'], val:{_name:'seph'}}, (err) =>
        assert.strictEqual err, 'Cannot set reserved value'
        done()

    it.skip 'does not let you set _cursor for a nonexistant doc', (done) ->
      @client.submitPresence @cName, @docName, {v:0, p:['id'], val:{_cursor:6}}, (err) =>
        assert.strictEqual err, 'Cannot set reserved value'
        done()

    it 'does let you set _cursor for a document', (done) -> @create =>
      @client.submitPresence @cName, @docName, {v:1, p:['id'], val:{_cursor:0}}, (err) =>
        throw new Error err if err
        @client.submitPresence @cName, @docName, {v:1, p:['id', '_cursor'], val:1}, (err) =>
          throw new Error err if err
          done()

  describe 'edits from ops', ->
    it 'deletes the cursor when a document is deleted', (done) -> @create =>
      @client.submitPresence @cName, @docName, {v:1, p:['id'], val:{x:'y', _cursor:0}}, (err) =>
        throw new Error err if err
        @collection.submit @docName, v:1, del:true, (err) =>
          throw new Error err if err
          @client.fetchPresence @cName, @docName, (err, presence) ->
            throw new Error err if err
            assert.deepEqual presence, {id:{x:'y'}}
            done()

    it 'moves the cursor when text is edited', (done) -> @create =>
      @client.submitPresence @cName, @docName, {v:1, p:['id'], val:{_cursor:[1,1]}}, (err) =>
        throw new Error err if err
        @collection.submit @docName, v:1, op:['hi'], (err) =>
          throw new Error err if err
          @client.fetchPresence @cName, @docName, (err, presence) ->
            throw new Error err if err
            assert.deepEqual presence, {id:{_cursor:[3,3]}}
            done()


  describe 'subscribe', ->
    it.skip 'propogates presence ops to subscribers', (done) -> @create =>
      # This test currently fails

      @client.subscribe @cName, @docName, 0, wantPresence:yes, (err, stream, presence) =>
        @client.submit @cName, @docName, v:1, op:['hi']
        throw new Error err if err
        assert.deepEqual presence, {}
        stream.on 'data', (data) ->
          console.log 'got data', data
          # assert.deepEqual data, {}
          # done()

        @client.submitPresence @cName, @docName, {v:0, id:'id', value:{x:'y'}}, (err) =>
          throw new Error err if err
