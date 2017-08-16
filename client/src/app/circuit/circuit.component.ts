import {AfterViewInit, Component, Input, OnInit, ViewChild} from '@angular/core';
//import {Schematic} from '../../circuit-sandbox/js/schematic.js';

declare var schematic: any;

@Component({
  selector: 'app-circuit',
  templateUrl: './circuit.component.html',
  styleUrls: ['./circuit.component.css']
})
export class CircuitComponent implements OnInit {
mode= 'false' ;
@ViewChild('aloha') input;
cir =  schematic  ;
x : any;
@Input() is_question= 'is_question';


  constructor() { }

  ngOnInit() {
  this.mode = 'True';
  this.input.nativeElement.setAttribute('height','460');
  this.input.nativeElement.setAttribute('width','800');
  this.x  = new this.cir.Schematic(this.input.nativeElement);
  this.x.printi();
  //this.x.is_question = true ;
  this.x.update_schematic1() ;
  console.log(this.input.nativeElement);
  console.log(this.x);
  }


  get_netlist() {
  let d=   this.x.json();
  console.log(d);
  }
}
