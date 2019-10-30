var PropTypes = require('prop-types');
var React = require('react');
var Player = require('./Player.jsx');
var _ = require('underscore');

function PlayerList(props) {
  var { players, selectedPlayerId } = props;
  var other = _.omit(props, 'players', 'selectedPlayerId');

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

PlayerList.propTypes = {
  players: PropTypes.array.isRequired,
  selectedPlayerId: PropTypes.string
};

module.exports = PlayerList;
