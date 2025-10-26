import Phaser from "phaser";
import { TankGameScene } from "./tankScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0d1f16",
  scene: [TankGameScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  render: {
    antialias: true
  }
};

new Phaser.Game(config);
