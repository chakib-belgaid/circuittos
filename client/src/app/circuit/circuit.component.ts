import {Component, Input, OnInit} from '@angular/core';

@Component({
  selector: 'app-circuit',
  templateUrl: './circuit.component.html',
  styleUrls: ['./circuit.component.css']
})
export class CircuitComponent implements OnInit {
mode= 'false' ;
@Input() is_question= 'is_question';
  constructor() { }

  ngOnInit() {
  this.mode = 'Tru e';
  }

}
