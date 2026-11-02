(function () {
  'use strict';
  const T = Terminal;

  T.registerExtension({
    name: 'maths',
    info: 'Maths Master Key imported successfully!',
    commands: {
      ADD: function (arg) {
        const n = arg.split(' ').map(Number);
        if (n.length < 2) throw new Error('Usage: ADD 5 10');
        this.printSystem(String(n[0] + n[1]));
      },
      SUB: function (arg) {
        const n = arg.split(' ').map(Number);
        if (n.length < 2) throw new Error('Usage: SUB 10 5');
        this.printSystem(String(n[0] - n[1]));
      },
      MUL: function (arg) {
        const n = arg.split(' ').map(Number);
        if (n.length < 2) throw new Error('Usage: MUL 5 10');
        this.printSystem(String(n[0] * n[1]));
      },
      DIV: function (arg) {
        const n = arg.split(' ').map(Number);
        if (n.length < 2) throw new Error('Usage: DIV 10 2');
        this.printSystem(String(n[0] / n[1]));
      },
      POW: function (arg) {
        const n = arg.split(' ').map(Number);
        if (n.length < 2) throw new Error('Usage: POW 2 3');
        this.printSystem(String(Math.pow(n[0], n[1])));
      },
      SQRT: function (arg) {
        const n = parseFloat(arg);
        if (isNaN(n)) throw new Error('Usage: SQRT 16');
        this.printSystem(String(Math.sqrt(n)));
      },
      PI: function () {
        this.printSystem(String(Math.PI));
      },
      E: function () {
        this.printSystem(String(Math.E));
      }
    }
  });
})();