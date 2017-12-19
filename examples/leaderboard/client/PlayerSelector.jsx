var React = require('react');

var PlayerSelector = React.createClass({
  propTypes: {
    selectedPlayer: React.PropTypes.object
  },

  render: function() {
    var node;

    if (this.props.selectedPlayer) {
      node = <div className="details">
        <div className="name">{this.props.selectedPlayer.data.name}</div>
        <button className="inc" onClick={this.props.onAddPoints}>Add 5 points</button>
      </div>;
    } else {
      node = <div className="message">Click a player to select</div>;
    }

    return node;
  }
});

module.exports = PlayerSelector;
