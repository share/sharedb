var React = require('react');
var Player = require('./Player.jsx');
var _ = require('underscore');

var PlayerList = React.createClass({
  propTypes: {
    players: React.PropTypes.array.isRequired,
    selectedPlayerId: React.PropTypes.string
  },

  render: function() {
    var { players, selectedPlayerId } = this.props;
    var other = _.omit(this.props, 'players', 'selectedPlayerId');

    var playerNodes = players.map(function(player, index) {
      var selected = selectedPlayerId === player.id;

      return (
        <Player {...other} doc={player} key={player.id} selected={selected} />
      );
    });
    return (
      <div className="playerList">
        {playerNodes}
      </div>
    );
  }
});

module.exports = PlayerList;