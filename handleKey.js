function bindKeys(input, actions) {
  input.on('data', (buffer) => {
    const keys = buffer.toString();

    // A terminal may deliver several keystrokes in one data event.
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const arrow = keys.slice(index, index + 3);
      if (key === '\u0003' || key.toLowerCase() === 'q') return actions.quit();
      if (arrow === '\u001b[A') {
        actions.up();
        index += 2;
      } else if (arrow === '\u001b[B') {
        actions.down();
        index += 2;
      } else if (key === '\r' || key === '\n') {
        actions.enter();
      } else if (key === ' ') {
        actions.space();
      }
    }
  });
}

module.exports = { bindKeys };
