var PlayerList = require('./PlayerList.jsx');
var PlayerSelector = require('./PlayerSelector.jsx');
var React = require('react');
var _ = require('underscore');
var connection = require('./connection');

class Leaderboard extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      selectedPlayerId: null,
      players: []
    };
    this.handlePlayerSelected = this.handlePlayerSelected.bind(this);
    this.handleAddPoints = this.handleAddPoints.bind(this);
  }

  componentDidMount() {
    var comp = this;
    var query = connection.createSubscribeQuery('players', {$sort: {score: -1}});
    query.on('ready', update);
    query.on('changed', update);

    function update() {
      comp.setState({players: query.results});
    }
  }

  componentWillUnmount() {
    query.destroy();
  }

  selectedPlayer() {
    return _.find(this.state.players, function(x) {
      return x.id === this.state.selectedPlayerId;
    }.bind(this));
  }

  handlePlayerSelected(id) {
    this.setState({selectedPlayerId: id});
  }

  handleAddPoints() {
    var op = [{p: ['score'], na: 5}];
    connection.get('players', this.state.selectedPlayerId).submitOp(op, function(err) {
      if (err) { console.error(err); return; }
    });
  }

  render() {
    return (
      <div>
        <div className="leaderboard">
          <PlayerList {...this.state} onPlayerSelected={this.handlePlayerSelected} />
        </div>
        <PlayerSelector selectedPlayer={this.selectedPlayer()} onAddPoints={this.handleAddPoints} />
      </div>
    );
  }
}

module.exports = Leaderboard;

