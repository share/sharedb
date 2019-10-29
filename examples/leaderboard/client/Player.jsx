var PropTypes = require('prop-types');
var React = require('react');
var classNames = require('classnames');

class Player extends React.Component {
  constructor(props) {
    super(props);
    this.handleClick = this.handleClick.bind(this);
  }

  handleClick(event) {
    this.props.onPlayerSelected(this.props.doc.id);
  }

  componentDidMount() {
    var comp = this;
    var doc = comp.props.doc;
    doc.subscribe();
    doc.on('load', update);
    doc.on('op', update);
    function update() {
      // `comp.props.doc.data` is now updated. re-render component.
      comp.forceUpdate();
    }
  }

  componentWillUnmount() {
    this.doc.unsubscribe();
  }

  render() {
    var classes = {
      'player': true,
      'selected': this.props.selected
    };

    return (
      <li className={classNames(classes)} onClick={this.handleClick}>
        <span className="name">{this.props.doc.data.name}</span>
        <span className="score">{this.props.doc.data.score}</span>
      </li>
    );
  }
}

Player.propTypes = {
  doc: PropTypes.object.isRequired,
  onPlayerSelected: PropTypes.func.isRequired,
  selected: PropTypes.bool.isRequired
};

module.exports = Player;
