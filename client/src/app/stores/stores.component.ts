import { Component, OnInit } from '@angular/core';
import {StoresService1} from '../stores.service';
import {Chaine} from '../chaine';

@Component({
  selector: 'app-stores',
  templateUrl: './stores.component.html',
  styleUrls: ['./stores.component.css']
})
export class StoresComponent implements OnInit {
  chaines: Chaine[] ;

  constructor(private storesevice: StoresService1) {  }

  ngOnInit() {
    this.getChaines();
  }

  private getChaines() {
    this.storesevice.getChaines().then(chaines => this.chaines = chaines);
  }

}
