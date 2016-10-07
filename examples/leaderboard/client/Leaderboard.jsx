var PlayerList = require('./PlayerList.jsx');
var PlayerSelector = require('./PlayerSelector.jsx');
var React = require('react');
var _ = require('underscore');
var connection = require('./connection');

var Leaderboard = React.createClass({
  getInitialState: function() {
    return {
      selectedPlayerId: null,
      players: []
    };
  },

  componentDidMount: function() {
    var comp = this;
    var query = connection.createSubscribeQuery('players', {$sort: {score: -1}});
    query.on('ready', update);
    query.on('changed', update);

    function update() {
      comp.setState({players: query.results});
    }
  },

  componentWillUnmount: function() {
    query.destroy();
  },

  selectedPlayer: function() {
    return _.find(this.state.players, function(x) {
      return x.id === this.state.selectedPlayerId;
    }.bind(this));
  },

  handlePlayerSelected: function(id) {
    this.setState({selectedPlayerId: id});
  },

  handleAddPoints: function() {
    var op = [{p: ['score'], na: 5}];
    connection.get('players', this.state.selectedPlayerId).submitOp(op, function(err) {
      if (err) { console.error(err); return; }
    });
  },

  render: function() {
    return (
      <div>
        <div className="leaderboard">
          <PlayerList {...this.state} onPlayerSelected={this.handlePlayerSelected} />
        </div>
        <PlayerSelector selectedPlayer={this.selectedPlayer()} onAddPoints={this.handleAddPoints} />
      </div>
    );
  }
});

module.exports = Leaderboard;

